import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import { verifyPersonalMessageSignature } from '@mysten/sui/verify';
import type { SuiHybridClient } from '../lib/suiHybridClient';
import { getSuiClient, getJsonRpcUrl } from '../lib/suiRpcConfig';
import { extractParlayLegIds } from '../utils/parlayParser';

const SBETS_PACKAGE_ID = (process.env.SBETS_TOKEN_ADDRESS || '0x999d696dad9e4684068fa74ef9c5d3afc411d3ba62973bd5d54830f324f29502').split('::')[0];
const SBETS_COIN_TYPE = `${SBETS_PACKAGE_ID}::sbets::SBETS`;
const USDSUI_COIN_TYPE = '0x44f838219cf67b058f3b37907b655f226153c18e33dfcd0da559a844fea9b1c1::usdsui::USDSUI';
const USDSUI_DECIMALS = 6; // USDsui uses 6 decimal places (1 USDSUI = 1_000_000 units)
const USDC_COIN_TYPE = (process.env.USDC_COIN_TYPE || '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC').trim();
const USDC_DECIMALS = 6; // Circle USDC uses 6 decimal places (1 USDC = 1_000_000 units)
const LBTC_COIN_TYPE = (process.env.LBTC_COIN_TYPE || '0x3e8e9423d80e1774a7ca128fccd8bf5f1f7753be658c5e645929037f7c819040::lbtc::LBTC').trim();
const LBTC_DECIMALS = 8; // Lombard LBTC — 8 decimal places (Bitcoin standard)
const BETTING_PACKAGE_ID = (process.env.BETTING_PACKAGE_ID || process.env.VITE_BETTING_PACKAGE_ID || '').trim();
const BETTING_PLATFORM_ID = (process.env.BETTING_PLATFORM_ID || process.env.VITE_BETTING_PLATFORM_ID || process.env.PLATFORM_ID || '').trim();

const ADMIN_CAP_ID = process.env.ADMIN_CAP_ID || '';
const MULTISIG_GUARD_ID = process.env.MULTISIG_GUARD_ID || '';
const ADMIN_WALLET = process.env.ADMIN_WALLET_ADDRESS || '';
const PLATFORM_REVENUE_WALLET = process.env.PLATFORM_REVENUE_WALLET || ADMIN_WALLET;
const REVENUE_WALLET = process.env.REVENUE_WALLET_ADDRESS || ADMIN_WALLET;
const ADMIN_PRIVATE_KEY = process.env.ADMIN_PRIVATE_KEY;
const REVENUE_WALLET_PRIVATE_KEY = process.env.REVENUE_WALLET_PRIVATE_KEY;

const PREDICT_TREASURY_WALLET = process.env.PREDICT_TREASURY_WALLET || '';
const PREDICT_TREASURY_PRIVATE_KEY = process.env.PREDICT_TREASURY_PRIVATE_KEY || '';

if (!BETTING_PACKAGE_ID || !BETTING_PLATFORM_ID) {
  console.warn('⚠️ BETTING_PACKAGE_ID or BETTING_PLATFORM_ID not set - on-chain betting disabled');
} else {
  console.log(`📦 Betting Package: ✅ Configured (${BETTING_PACKAGE_ID.slice(0, 10)}...)`);
  console.log(`🏛️ Platform Object: ✅ Configured (${BETTING_PLATFORM_ID.slice(0, 10)}...)`);
  if (BETTING_PACKAGE_ID === BETTING_PLATFORM_ID) {
    console.error('🚨 FATAL: BETTING_PACKAGE_ID and BETTING_PLATFORM_ID are the same! Settlement will fail.');
  }
}
console.log(`🎫 Admin Cap: ${ADMIN_CAP_ID ? '✅ Configured' : '⚠️ NOT SET'}`);
console.log(`👤 Admin Wallet: ${ADMIN_WALLET ? '✅ Configured' : '⚠️ NOT SET'}`);
console.log(`🔐 Admin Private Key: ${ADMIN_PRIVATE_KEY ? '✅ Configured' : '⚠️ NOT SET'}`);
console.log(`💰 Revenue Wallet Key: ${REVENUE_WALLET_PRIVATE_KEY ? '✅ Configured' : '⚠️ NOT SET'}`);
if (REVENUE_WALLET_PRIVATE_KEY && REVENUE_WALLET) {
  try {
    let tempKeyBytes: Uint8Array | null = null;
    let tempKeypair: Ed25519Keypair | null = null;
    if (REVENUE_WALLET_PRIVATE_KEY.startsWith('suiprivkey')) {
      const decoded = decodeSuiPrivateKey(REVENUE_WALLET_PRIVATE_KEY);
      tempKeypair = Ed25519Keypair.fromSecretKey(decoded.secretKey);
    } else if (REVENUE_WALLET_PRIVATE_KEY.startsWith('0x')) {
      tempKeyBytes = new Uint8Array(Buffer.from(REVENUE_WALLET_PRIVATE_KEY.slice(2), 'hex'));
    } else {
      tempKeyBytes = new Uint8Array(Buffer.from(REVENUE_WALLET_PRIVATE_KEY, 'base64'));
    }
    if (tempKeyBytes) {
      if (tempKeyBytes.length === 33 && tempKeyBytes[0] === 0) tempKeyBytes = tempKeyBytes.slice(1);
      else if (tempKeyBytes.length === 65 && tempKeyBytes[0] === 0) tempKeyBytes = tempKeyBytes.slice(1, 33);
      else if (tempKeyBytes.length === 64) tempKeyBytes = tempKeyBytes.slice(0, 32);
      if (tempKeyBytes.length === 32) tempKeypair = Ed25519Keypair.fromSecretKey(tempKeyBytes);
    }
    if (tempKeypair) {
      const derivedAddress = tempKeypair.toSuiAddress();
      if (derivedAddress.toLowerCase() !== REVENUE_WALLET.toLowerCase()) {
        console.warn(`⚠️ REVENUE_WALLET_ADDRESS (${REVENUE_WALLET.slice(0,12)}...) does NOT match derived key address (${derivedAddress.slice(0,12)}...)`);
      } else {
        console.log(`✅ Revenue wallet address matches key: ${derivedAddress.slice(0,12)}...`);
      }
    }
  } catch (e) {
    console.warn('⚠️ Could not validate revenue wallet key at startup');
  }
}

if (PREDICT_TREASURY_WALLET) {
  console.log(`🔮 Predict Treasury Wallet: ✅ ${PREDICT_TREASURY_WALLET.slice(0, 12)}... (separate from betting)`);
} else {
  console.log(`🔮 Predict Treasury: Using betting admin wallet (set PREDICT_TREASURY_WALLET for separation)`);
}
if (PREDICT_TREASURY_PRIVATE_KEY) {
  console.log(`🔮 Predict Treasury Key: ✅ Configured`);
}

const PREDICTION_PACKAGE_ID = '0xbeca02b587c7bdc696c84141f7f28649e3b810c83325a6113deb93a9fd403924';
const PREDICTION_PLATFORM_CONFIG_ID = '0x4aaecdbaf78e335d4a73784f22ccaec79ffcc0334f9ed4e914eb691dc0cb53ca';
const PREDICTION_ADMIN_CAP_ID = '0xbd36e8fab0c51eda01b75c3d8a6bac9baa9783fe62ebdd8cc9997ec9fce4fe98';
const SUI_CLOCK_ID = '0x6';

function getPredictCoinType(currency: string): string {
  if (currency === 'SUI') return '0x2::sui::SUI';
  if (currency === 'USDSUI') return USDSUI_COIN_TYPE;
  return SBETS_COIN_TYPE;
}

function getPredictDecimals(currency: string): number {
  return currency === 'USDSUI' ? 6 : 9;
}

console.log(`🔮 Prediction Contract: ✅ ${PREDICTION_PACKAGE_ID.slice(0, 12)}...`);

export interface OnChainBet {
  betId: string;
  walletAddress: string;
  eventId: string;
  prediction: string;
  betAmount: number;
  odds: number;
  potentialPayout: number;
  txHash: string;
  blockHeight?: number;
  timestamp: number;
  status: 'pending' | 'confirmed' | 'settled' | 'failed';
}

export interface TransactionPayload {
  target: string;
  arguments: any[];
  typeArguments?: string[];
}

const rejectedOnChainBets = new Set<string>();

export class BlockchainBetService {
  private client: SuiHybridClient;
  private network: 'mainnet' | 'testnet' | 'devnet';

  private static readonly KNOWN_SPORT_SLUGS = new Set([
    'basketball', 'baseball', 'ice-hockey', 'mma', 'american-football',
    'afl', 'formula-1', 'handball', 'nfl', 'rugby', 'volleyball',
    'tennis', 'boxing', 'horse-racing', 'cricket', 'wwe', 'motogp',
    'table-tennis', 'esports'
  ]);

  private verifyClient: SuiJsonRpcClient;

  constructor() {
    this.network = (process.env.SUI_NETWORK as 'mainnet' | 'testnet' | 'devnet') || 'mainnet';
    this.client = getSuiClient(this.network as any);
    this.verifyClient = new SuiJsonRpcClient({ url: getJsonRpcUrl(this.network as any), network: this.network });
    console.log(`BlockchainBetService initialized on ${this.network}`);
  }

  /**
   * Verify a Sui personal message signature. Uses a SuiClient so zkLogin and
   * multisig wallets are supported. Returns true if valid, throws on failure.
   */
  async verifyWalletSignature(message: string, signature: string, address: string): Promise<void> {
    const msgBytes = new TextEncoder().encode(message);
    await verifyPersonalMessageSignature(msgBytes, signature, {
      address: address.toLowerCase(),
      client: this.verifyClient,
    });
  }

  private extractParlayLegIds(extId: string): string[] {
    return extractParlayLegIds(extId);
  }

  async buildBetTransaction(
    walletAddress: string,
    eventId: string,
    prediction: string,
    betAmount: number,
    odds: number,
    marketId: string = 'match_winner',
    walrusBlobId: string = ''
  ): Promise<TransactionPayload> {
    const oddsInBps = Math.floor(odds * 100);

    return {
      target: `${BETTING_PACKAGE_ID}::betting::place_bet`,
      arguments: [
        BETTING_PLATFORM_ID,
        Array.from(new TextEncoder().encode(eventId)),
        Array.from(new TextEncoder().encode(marketId)),
        Array.from(new TextEncoder().encode(prediction)),
        oddsInBps,
        0,
        [],
        Array.from(new TextEncoder().encode(walrusBlobId)),
        '0x6',
      ],
      typeArguments: []
    };
  }

  buildClientTransaction(
    eventId: string,
    prediction: string,
    betAmountMist: number,
    odds: number,
    marketId: string,
    walrusBlobId: string
  ): {
    packageId: string;
    module: string;
    function: string;
    platformId: string;
    betAmountMist: number;
    clockObjectId: string;
    moveCallArgs: {
      platform: string;
      eventId: number[];
      marketId: number[];
      prediction: number[];
      oddsBps: number;
      walrusBlobId: number[];
    };
    instructions: string;
  } {
    return {
      packageId: BETTING_PACKAGE_ID,
      module: 'betting',
      function: 'place_bet',
      platformId: BETTING_PLATFORM_ID,
      betAmountMist,
      clockObjectId: '0x6',
      moveCallArgs: {
        platform: BETTING_PLATFORM_ID,
        eventId: Array.from(new TextEncoder().encode(eventId)),
        marketId: Array.from(new TextEncoder().encode(marketId)),
        prediction: Array.from(new TextEncoder().encode(prediction)),
        oddsBps: Math.floor(odds * 100),
        walrusBlobId: Array.from(new TextEncoder().encode(walrusBlobId)),
      },
      instructions: `
        1. Get oracle signature from /api/oracle/sign-bet
        2. Split ${betAmountMist} MIST from your SUI coins
        3. Call ${BETTING_PACKAGE_ID}::betting::place_bet with:
           - platform: ${BETTING_PLATFORM_ID} (shared object)
           - payment: [split coin]
           - event_id, market_id, prediction: [encoded bytes]
           - odds: ${Math.floor(odds * 100)} (basis points)
           - quote_expiry: [from oracle response]
           - oracle_signature: [from oracle response]
           - walrus_blob_id: [encoded bytes]
           - clock: 0x6
      `.trim()
    };
  }

  async buildSettlementTransaction(
    betId: string,
    betObjectId: string,
    won: boolean
  ): Promise<TransactionPayload> {
    // Full contract signature: settle_bet_admin(admin_cap, platform, bet, won, clock)
    return {
      target: `${BETTING_PACKAGE_ID}::betting::settle_bet_admin`,
      arguments: [
        BETTING_PLATFORM_ID,
        betObjectId,
        won,
        '0x6', // clock object
      ],
      typeArguments: []
    };
  }

  getBettingPlatformId(): string {
    return BETTING_PLATFORM_ID;
  }

  async verifyTransaction(txHash: string): Promise<{
    confirmed: boolean;
    blockHeight?: number;
    timestamp?: number;
    effects?: any;
    sender?: string;
  }> {
    try {
      const txResponse = await this.client.getTransactionBlock({
        digest: txHash,
        options: {
          showEffects: true,
          showEvents: true,
          showInput: true
        }
      });

      if (txResponse && txResponse.effects) {
        return {
          confirmed: txResponse.effects.status?.status === 'success',
          blockHeight: parseInt(txResponse.checkpoint || '0'),
          timestamp: parseInt(txResponse.timestampMs || '0'),
          effects: txResponse.effects,
          sender: txResponse.transaction?.data?.sender
        };
      }

      return { confirmed: false };
    } catch (error) {
      console.error('Error verifying transaction:', error);
      return { confirmed: false };
    }
  }

  async verifySbetsTransfer(txHash: string, expectedSender: string, expectedAmount: number): Promise<{
    verified: boolean;
    sender?: string;
    recipient?: string;
    amount?: number;
    error?: string;
  }> {
    if (!txHash || typeof txHash !== 'string' || txHash.length < 20) {
      return { verified: false, error: 'Invalid transaction hash' };
    }

    const MAX_RETRIES = 5;
    const RETRY_DELAYS = [2000, 3000, 4000, 5000, 6000];
    let lastError = '';

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        if (attempt > 0) {
          const delay = RETRY_DELAYS[attempt - 1] || 6000;
          console.log(`[Verify] Retry ${attempt}/${MAX_RETRIES - 1} for TX ${txHash.slice(0, 12)}... (waiting ${delay}ms for indexing)`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }

        const fetchOptions = {
          showEffects: true,
          showBalanceChanges: true,
          showInput: true,
          showObjectChanges: true,
        };

        let txResponse;
        try {
          txResponse = await this.client.waitForTransaction({
            digest: txHash,
            timeout: 10000,
            pollInterval: 1500,
            options: fetchOptions,
          });
        } catch (waitErr: any) {
          txResponse = await this.client.getTransactionBlock({
            digest: txHash,
            options: fetchOptions,
          });
        }

        if (!txResponse) {
          lastError = 'Transaction not found on-chain';
          continue;
        }

        if (txResponse.effects?.status?.status !== 'success') {
          return { verified: false, error: 'Transaction failed on-chain' };
        }

        const sender = txResponse.transaction?.data?.sender;
        if (!sender || sender.toLowerCase() !== expectedSender.toLowerCase()) {
          return { verified: false, error: `Sender mismatch: expected ${expectedSender.slice(0,10)}..., got ${sender?.slice(0,10)}...` };
        }

        const balanceChanges = txResponse.balanceChanges || [];
        console.log(`[Verify] TX ${txHash.slice(0, 12)}... balance changes (attempt ${attempt + 1}):`, JSON.stringify(balanceChanges.map((bc: any) => ({ coinType: bc.coinType, amount: bc.amount, owner: bc.owner }))));

        const sbetsChanges = balanceChanges.filter((bc: any) =>
          bc.coinType && bc.coinType.includes('::sbets::SBETS')
        );

        if (sbetsChanges.length > 0) {
          const adminWallet = ADMIN_WALLET.toLowerCase();
          const adminReceive = sbetsChanges.find((bc: any) =>
            bc.owner?.AddressOwner?.toLowerCase() === adminWallet &&
            BigInt(bc.amount) > 0
          );

          if (!adminReceive) {
            const recipients = sbetsChanges.filter((bc: any) => BigInt(bc.amount) > 0).map((bc: any) => bc.owner?.AddressOwner?.slice(0, 10) || 'unknown');
            return { verified: false, error: `SBETS not sent to platform treasury wallet (sent to: ${recipients.join(', ')})` };
          }

          const receivedAmount = Number(BigInt(adminReceive.amount)) / 1_000_000_000;
          if (receivedAmount < expectedAmount) {
            return { verified: false, error: `Amount too low: expected ${expectedAmount} SBETS, received ${receivedAmount} SBETS` };
          }
          if (receivedAmount > expectedAmount * 1.5) {
            return { verified: false, error: `Amount suspiciously high: expected ${expectedAmount} SBETS, received ${receivedAmount} SBETS` };
          }

          console.log(`[Verify] SBETS transfer verified via balanceChanges: ${sender.slice(0,10)}... -> treasury | ${receivedAmount} SBETS | TX: ${txHash}`);
          return {
            verified: true,
            sender,
            recipient: adminWallet,
            amount: receivedAmount
          };
        }

        const objectChanges = txResponse.objectChanges || [];
        const sbetsObjectChanges = objectChanges.filter((oc: any) =>
          oc.objectType && oc.objectType.includes('::sbets::SBETS') ||
          oc.type === 'created' && oc.objectType?.includes('0x2::coin::Coin') && oc.objectType?.includes('sbets')
        );

        if (sbetsObjectChanges.length > 0) {
          console.log(`[Verify] TX ${txHash.slice(0, 12)}... SBETS object changes found:`, JSON.stringify(sbetsObjectChanges.map((oc: any) => ({ type: oc.type, objectType: oc.objectType, owner: oc.owner }))));

          const adminWallet = ADMIN_WALLET.toLowerCase();
          const createdForAdmin = sbetsObjectChanges.find((oc: any) =>
            (oc.type === 'created' || oc.type === 'mutated') &&
            oc.owner?.AddressOwner?.toLowerCase() === adminWallet
          );

          if (createdForAdmin) {
            console.log(`[Verify] SBETS transfer verified via objectChanges (coin object created/mutated for treasury): ${sender.slice(0,10)}... -> treasury | TX: ${txHash}`);
            return {
              verified: true,
              sender,
              recipient: adminWallet,
              amount: expectedAmount
            };
          }
        }

        const effects = txResponse.effects;
        if (effects?.created || effects?.mutated) {
          const allAffected = [...(effects.created || []), ...(effects.mutated || [])];
          const adminOwned = allAffected.filter((obj: any) =>
            obj.owner?.AddressOwner?.toLowerCase() === ADMIN_WALLET.toLowerCase()
          );

          if (adminOwned.length > 0 && attempt >= 2) {
            const senderSent = sbetsChanges.length === 0 && balanceChanges.some((bc: any) =>
              bc.coinType?.includes('SUI') && BigInt(bc.amount) < 0
            );

            if (senderSent || adminOwned.length > 0) {
              try {
                for (const obj of adminOwned) {
                  const objectId = obj.reference?.objectId;
                  if (!objectId) continue;
                  const objData = await this.client.getObject({
                    id: objectId,
                    options: { showType: true }
                  });
                  if (objData?.data?.type?.includes('::sbets::SBETS')) {
                    console.log(`[Verify] SBETS transfer verified via object inspection: Object ${objectId} is SBETS coin owned by treasury | TX: ${txHash}`);
                    return {
                      verified: true,
                      sender,
                      recipient: ADMIN_WALLET.toLowerCase(),
                      amount: expectedAmount
                    };
                  }
                }
              } catch (objErr: any) {
                console.error(`[Verify] Object inspection failed: ${objErr.message}`);
              }
            }
          }
        }

        lastError = `No SBETS transfer found in transaction (${balanceChanges.length} balance changes found, types: ${balanceChanges.map((bc: any) => bc.coinType?.split('::').pop() || 'unknown').join(', ') || 'none'})`;
        if (attempt < MAX_RETRIES - 1) continue;
        return { verified: false, error: lastError };
      } catch (error: any) {
        lastError = error.message;
        console.error(`[Verify] Attempt ${attempt + 1}/${MAX_RETRIES} failed for TX ${txHash.slice(0, 12)}...: ${error.message}`);
        if (attempt === MAX_RETRIES - 1) {
          return { verified: false, error: `Verification failed after ${MAX_RETRIES} attempts: ${lastError}` };
        }
      }
    }
    return { verified: false, error: `Verification failed: ${lastError}` };
  }

  async verifyUsdsuiTransfer(txHash: string, expectedSender: string, expectedAmount: number): Promise<{
    verified: boolean;
    sender?: string;
    recipient?: string;
    amount?: number;
    error?: string;
  }> {
    if (!txHash || typeof txHash !== 'string' || txHash.length < 20) {
      return { verified: false, error: 'Invalid transaction hash' };
    }

    const MAX_RETRIES = 5;
    const RETRY_DELAYS = [2000, 3000, 4000, 5000, 6000];
    let lastError = '';

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        if (attempt > 0) {
          const delay = RETRY_DELAYS[attempt - 1] || 6000;
          console.log(`[Verify-USDSUI] Retry ${attempt}/${MAX_RETRIES - 1} for TX ${txHash.slice(0, 12)}... (waiting ${delay}ms)`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }

        const fetchOptions = { showEffects: true, showBalanceChanges: true, showInput: true, showObjectChanges: true };
        let txResponse;
        try {
          txResponse = await this.client.waitForTransaction({ digest: txHash, timeout: 10000, pollInterval: 1500, options: fetchOptions });
        } catch {
          txResponse = await this.client.getTransactionBlock({ digest: txHash, options: fetchOptions });
        }

        if (!txResponse) { lastError = 'Transaction not found on-chain'; continue; }
        if (txResponse.effects?.status?.status !== 'success') return { verified: false, error: 'Transaction failed on-chain' };

        const sender = txResponse.transaction?.data?.sender;
        if (!sender || sender.toLowerCase() !== expectedSender.toLowerCase()) {
          return { verified: false, error: `Sender mismatch: expected ${expectedSender.slice(0,10)}..., got ${sender?.slice(0,10)}...` };
        }

        const balanceChanges = txResponse.balanceChanges || [];
        console.log(`[Verify-USDSUI] TX ${txHash.slice(0, 12)}... balance changes:`, JSON.stringify(balanceChanges.map((bc: any) => ({ coinType: bc.coinType, amount: bc.amount }))));

        const usdsuiChanges = balanceChanges.filter((bc: any) =>
          bc.coinType && bc.coinType.includes('::usdsui::USDSUI')
        );

        if (usdsuiChanges.length > 0) {
          const adminWallet = ADMIN_WALLET.toLowerCase();
          const adminReceive = usdsuiChanges.find((bc: any) =>
            bc.owner?.AddressOwner?.toLowerCase() === adminWallet && BigInt(bc.amount) > 0
          );

          if (!adminReceive) {
            const recipients = usdsuiChanges.filter((bc: any) => BigInt(bc.amount) > 0).map((bc: any) => bc.owner?.AddressOwner?.slice(0, 10) || 'unknown');
            return { verified: false, error: `USDsui not sent to platform treasury (sent to: ${recipients.join(', ')})` };
          }

          const receivedAmount = Number(BigInt(adminReceive.amount)) / Math.pow(10, USDSUI_DECIMALS);
          if (receivedAmount < expectedAmount * 0.99) {
            return { verified: false, error: `Amount too low: expected ${expectedAmount} USDsui, received ${receivedAmount} USDsui` };
          }

          console.log(`[Verify-USDSUI] Transfer verified: ${sender.slice(0,10)}... -> treasury | ${receivedAmount} USDsui | TX: ${txHash}`);
          return { verified: true, sender, recipient: adminWallet, amount: receivedAmount };
        }

        lastError = `No USDsui transfer found in transaction (${balanceChanges.length} balance changes, types: ${balanceChanges.map((bc: any) => bc.coinType?.split('::').pop() || 'unknown').join(', ') || 'none'})`;
        if (attempt < MAX_RETRIES - 1) continue;
        return { verified: false, error: lastError };
      } catch (error: any) {
        lastError = error.message;
        console.error(`[Verify-USDSUI] Attempt ${attempt + 1}/${MAX_RETRIES} failed: ${error.message}`);
        if (attempt === MAX_RETRIES - 1) {
          return { verified: false, error: `Verification failed after ${MAX_RETRIES} attempts: ${lastError}` };
        }
      }
    }
    return { verified: false, error: `Verification failed: ${lastError}` };
  }

  async verifyUsdcTransfer(txHash: string, expectedSender: string, expectedAmount: number): Promise<{
    verified: boolean;
    sender?: string;
    recipient?: string;
    amount?: number;
    error?: string;
  }> {
    if (!txHash || typeof txHash !== 'string' || txHash.length < 20) {
      return { verified: false, error: 'Invalid transaction hash' };
    }

    const MAX_RETRIES = 5;
    const RETRY_DELAYS = [2000, 3000, 4000, 5000, 6000];
    let lastError = '';

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        if (attempt > 0) {
          const delay = RETRY_DELAYS[attempt - 1] || 6000;
          console.log(`[Verify-USDC] Retry ${attempt}/${MAX_RETRIES - 1} for TX ${txHash.slice(0, 12)}... (waiting ${delay}ms)`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }

        const fetchOptions = { showEffects: true, showBalanceChanges: true, showInput: true, showObjectChanges: true };
        let txResponse;
        try {
          txResponse = await this.client.waitForTransaction({ digest: txHash, timeout: 10000, pollInterval: 1500, options: fetchOptions });
        } catch {
          txResponse = await this.client.getTransactionBlock({ digest: txHash, options: fetchOptions });
        }

        if (!txResponse) { lastError = 'Transaction not found on-chain'; continue; }
        if (txResponse.effects?.status?.status !== 'success') return { verified: false, error: 'Transaction failed on-chain' };

        const sender = txResponse.transaction?.data?.sender;
        if (!sender || sender.toLowerCase() !== expectedSender.toLowerCase()) {
          return { verified: false, error: `Sender mismatch: expected ${expectedSender.slice(0,10)}..., got ${sender?.slice(0,10)}...` };
        }

        const balanceChanges = txResponse.balanceChanges || [];
        console.log(`[Verify-USDC] TX ${txHash.slice(0, 12)}... balance changes:`, JSON.stringify(balanceChanges.map((bc: any) => ({ coinType: bc.coinType, amount: bc.amount }))));

        const usdcChanges = balanceChanges.filter((bc: any) =>
          bc.coinType && (bc.coinType.includes('::usdc::USDC') || bc.coinType === USDC_COIN_TYPE)
        );

        if (usdcChanges.length > 0) {
          const adminWallet = ADMIN_WALLET.toLowerCase();
          // Also accept P2P contract ownership (onchain escrow path)
          const adminReceive = usdcChanges.find((bc: any) =>
            bc.owner?.AddressOwner?.toLowerCase() === adminWallet && BigInt(bc.amount) > 0
          ) ?? usdcChanges.find((bc: any) => BigInt(bc.amount) > 0);

          if (!adminReceive) {
            const recipients = usdcChanges.filter((bc: any) => BigInt(bc.amount) > 0).map((bc: any) => bc.owner?.AddressOwner?.slice(0, 10) || 'unknown');
            return { verified: false, error: `USDC not sent to platform treasury (sent to: ${recipients.join(', ')})` };
          }

          const receivedAmount = Number(BigInt(adminReceive.amount)) / Math.pow(10, USDC_DECIMALS);
          if (receivedAmount < expectedAmount * 0.99) {
            return { verified: false, error: `Amount too low: expected ${expectedAmount} USDC, received ${receivedAmount} USDC` };
          }

          console.log(`[Verify-USDC] Transfer verified: ${sender.slice(0,10)}... -> treasury | ${receivedAmount} USDC | TX: ${txHash}`);
          return { verified: true, sender, recipient: adminReceive.owner?.AddressOwner ?? adminWallet, amount: receivedAmount };
        }

        lastError = `No USDC transfer found in transaction (${balanceChanges.length} balance changes, types: ${balanceChanges.map((bc: any) => bc.coinType?.split('::').pop() || 'unknown').join(', ') || 'none'})`;
        if (attempt < MAX_RETRIES - 1) continue;
        return { verified: false, error: lastError };
      } catch (error: any) {
        lastError = error.message;
        console.error(`[Verify-USDC] Attempt ${attempt + 1}/${MAX_RETRIES} failed: ${error.message}`);
        if (attempt === MAX_RETRIES - 1) {
          return { verified: false, error: `Verification failed after ${MAX_RETRIES} attempts: ${lastError}` };
        }
      }
    }
    return { verified: false, error: `Verification failed: ${lastError}` };
  }

  async getWalletBalance(walletAddress: string): Promise<{
    sui: number;
    sbets: number;
    usdsui: number;
    usdc: number;
    lbtc: number;
  }> {
    try {
      const suiBalance = await this.client.getBalance({
        owner: walletAddress,
        coinType: '0x2::sui::SUI'
      });

      let sbetsBalance = { totalBalance: '0' };
      try {
        sbetsBalance = await this.client.getBalance({
          owner: walletAddress,
          coinType: `${SBETS_PACKAGE_ID}::sbets::SBETS`
        });
      } catch (e) {
      }

      let usdsuiBalance = { totalBalance: '0' };
      try {
        usdsuiBalance = await this.client.getBalance({
          owner: walletAddress,
          coinType: USDSUI_COIN_TYPE
        });
      } catch (e) {
      }

      let usdcBalance = { totalBalance: '0' };
      try {
        usdcBalance = await this.client.getBalance({
          owner: walletAddress,
          coinType: USDC_COIN_TYPE
        });
      } catch (e) {
      }

      let lbtcBalance = { totalBalance: '0' };
      try {
        lbtcBalance = await this.client.getBalance({
          owner: walletAddress,
          coinType: LBTC_COIN_TYPE
        });
      } catch (e) {
      }

      return {
        sui: parseInt(suiBalance.totalBalance) / 1e9,
        sbets: parseInt(sbetsBalance.totalBalance) / 1e9,
        usdsui: parseInt(usdsuiBalance.totalBalance) / Math.pow(10, USDSUI_DECIMALS),
        usdc: parseInt(usdcBalance.totalBalance) / Math.pow(10, USDC_DECIMALS),
        lbtc: parseInt(lbtcBalance.totalBalance) / Math.pow(10, LBTC_DECIMALS),
      };
    } catch (error) {
      console.error('Error getting wallet balance:', error);
      return { sui: 0, sbets: 0, usdsui: 0, usdc: 0, lbtc: 0 };
    }
  }

  async recordBetOnChain(bet: {
    betId: string;
    walletAddress: string;
    eventId: string;
    prediction: string;
    betAmount: number;
    odds: number;
    txHash: string;
  }): Promise<OnChainBet> {
    const onChainBet: OnChainBet = {
      betId: bet.betId,
      walletAddress: bet.walletAddress,
      eventId: bet.eventId,
      prediction: bet.prediction,
      betAmount: bet.betAmount,
      odds: bet.odds,
      potentialPayout: bet.betAmount * bet.odds,
      txHash: bet.txHash,
      timestamp: Date.now(),
      status: 'pending'
    };

    if (bet.txHash && bet.txHash.startsWith('0x') && bet.txHash.length > 10) {
      const verification = await this.verifyTransaction(bet.txHash);
      if (verification.confirmed) {
        onChainBet.status = 'confirmed';
        onChainBet.blockHeight = verification.blockHeight;
      }
    }

    console.log(`📦 ON-CHAIN BET RECORDED: ${bet.betId} | ${bet.walletAddress.slice(0, 8)}... | ${bet.betAmount} SUI @ ${bet.odds}x`);

    return onChainBet;
  }

  async getOnChainBetStatus(txHash: string): Promise<'pending' | 'confirmed' | 'failed'> {
    const verification = await this.verifyTransaction(txHash);
    if (verification.confirmed) {
      return 'confirmed';
    }
    return 'pending';
  }

  getPackageId(): string {
    return SBETS_PACKAGE_ID;
  }

  getBettingPackageId(): string {
    return BETTING_PACKAGE_ID;
  }

  getRevenueWallet(): string {
    return REVENUE_WALLET;
  }

  getAdminWallet(): string {
    return ADMIN_WALLET;
  }

  // Check if admin key is configured for on-chain payouts
  isAdminKeyConfigured(): boolean {
    return !!ADMIN_PRIVATE_KEY && ADMIN_PRIVATE_KEY.length > 0;
  }

  getAdminKeypair(): Ed25519Keypair | null {
    if (!ADMIN_PRIVATE_KEY) {
      console.warn('⚠️ ADMIN_PRIVATE_KEY not configured - on-chain payouts disabled');
      return null;
    }
    
    try {
      let keyBytes: Uint8Array;
      
      // Support multiple formats: hex, base64, or Sui bech32 format
      if (ADMIN_PRIVATE_KEY.startsWith('suiprivkey')) {
        // Sui bech32 format - use decodeSuiPrivateKey
        try {
          const decoded = decodeSuiPrivateKey(ADMIN_PRIVATE_KEY);
          return Ed25519Keypair.fromSecretKey(decoded.secretKey);
        } catch (e) {
          console.error('❌ Failed to parse Sui bech32 private key:', e);
          return null;
        }
      } else if (ADMIN_PRIVATE_KEY.startsWith('0x')) {
        // Hex format
        const hexKey = ADMIN_PRIVATE_KEY.slice(2);
        keyBytes = new Uint8Array(Buffer.from(hexKey, 'hex'));
      } else {
        // Assume base64 encoding
        keyBytes = new Uint8Array(Buffer.from(ADMIN_PRIVATE_KEY, 'base64'));
      }
      
      // Handle different key formats:
      // - 32 bytes: raw secret seed (ready to use)
      // - 33 bytes: 1 scheme byte + 32 secret seed (strip scheme)
      // - 64 bytes: 32 secret + 32 public (use first 32)
      // - 65 bytes: 1 scheme + 32 secret + 32 public (strip scheme, use first 32)
      
      if (keyBytes.length === 33 && keyBytes[0] === 0) {
        // Strip the scheme byte prefix (0x00 for Ed25519)
        keyBytes = keyBytes.slice(1);
      } else if (keyBytes.length === 65 && keyBytes[0] === 0) {
        // Strip scheme byte and take first 32 bytes (secret seed)
        keyBytes = keyBytes.slice(1, 33);
      } else if (keyBytes.length === 64) {
        // Full keypair format (secret + public), take only first 32 bytes
        keyBytes = keyBytes.slice(0, 32);
      }
      
      if (keyBytes.length !== 32) {
        console.error(`❌ Invalid private key length: ${keyBytes.length} (expected 32 bytes)`);
        console.error('   Supported formats: 32-byte raw seed, 33-byte with scheme prefix, or suiprivkey bech32');
        return null;
      }
      
      const keypair = Ed25519Keypair.fromSecretKey(keyBytes);
      console.log(`✅ Admin keypair loaded: ${keypair.toSuiAddress().slice(0, 12)}...`);
      return keypair;
    } catch (error) {
      console.error('❌ Failed to parse ADMIN_PRIVATE_KEY: invalid format or encoding');
      return null;
    }
  }

  isRevenueKeyConfigured(): boolean {
    return !!REVENUE_WALLET_PRIVATE_KEY && REVENUE_WALLET_PRIVATE_KEY.length > 0;
  }

  getRevenueKeypair(): Ed25519Keypair | null {
    if (!REVENUE_WALLET_PRIVATE_KEY) {
      console.warn('⚠️ REVENUE_WALLET_PRIVATE_KEY not configured');
      return null;
    }

    try {
      let keyBytes: Uint8Array;

      if (REVENUE_WALLET_PRIVATE_KEY.startsWith('suiprivkey')) {
        const decoded = decodeSuiPrivateKey(REVENUE_WALLET_PRIVATE_KEY);
        return Ed25519Keypair.fromSecretKey(decoded.secretKey);
      } else if (REVENUE_WALLET_PRIVATE_KEY.startsWith('0x')) {
        const hexKey = REVENUE_WALLET_PRIVATE_KEY.slice(2);
        keyBytes = new Uint8Array(Buffer.from(hexKey, 'hex'));
      } else {
        keyBytes = new Uint8Array(Buffer.from(REVENUE_WALLET_PRIVATE_KEY, 'base64'));
      }

      if (keyBytes.length === 33 && keyBytes[0] === 0) {
        keyBytes = keyBytes.slice(1);
      } else if (keyBytes.length === 65 && keyBytes[0] === 0) {
        keyBytes = keyBytes.slice(1, 33);
      } else if (keyBytes.length === 64) {
        keyBytes = keyBytes.slice(0, 32);
      }

      if (keyBytes.length !== 32) {
        console.error(`❌ Invalid revenue wallet key length: ${keyBytes.length}`);
        return null;
      }

      const keypair = Ed25519Keypair.fromSecretKey(keyBytes);
      console.log(`✅ Revenue keypair loaded: ${keypair.toSuiAddress().slice(0, 12)}...`);
      return keypair;
    } catch (error) {
      console.error('❌ Failed to parse REVENUE_WALLET_PRIVATE_KEY');
      return null;
    }
  }

  getPredictTreasuryWallet(): string {
    return PREDICT_TREASURY_WALLET || ADMIN_WALLET;
  }

  isPredictWalletSeparate(): boolean {
    return !!PREDICT_TREASURY_WALLET && PREDICT_TREASURY_WALLET.toLowerCase() !== ADMIN_WALLET.toLowerCase();
  }

  getPredictKeypair(): Ed25519Keypair | null {
    const key = PREDICT_TREASURY_PRIVATE_KEY || ADMIN_PRIVATE_KEY;
    if (!key) return null;
    try {
      let keyBytes: Uint8Array;
      if (key.startsWith('suiprivkey')) {
        const decoded = decodeSuiPrivateKey(key);
        return Ed25519Keypair.fromSecretKey(decoded.secretKey);
      } else if (key.startsWith('0x')) {
        keyBytes = new Uint8Array(Buffer.from(key.slice(2), 'hex'));
      } else {
        keyBytes = new Uint8Array(Buffer.from(key, 'base64'));
      }
      if (keyBytes.length === 33 && keyBytes[0] === 0) keyBytes = keyBytes.slice(1);
      else if (keyBytes.length === 65 && keyBytes[0] === 0) keyBytes = keyBytes.slice(1, 33);
      else if (keyBytes.length === 64) keyBytes = keyBytes.slice(0, 32);
      if (keyBytes.length !== 32) return null;
      return Ed25519Keypair.fromSecretKey(keyBytes);
    } catch { return null; }
  }

  async sendPredictPayout(recipientAddress: string, amount: number, currency: string): Promise<{ success: boolean; txHash?: string; error?: string }> {
    const label = `[PREDICT-PAYOUT]`;
    if (amount <= 0) return { success: false, error: 'Amount must be positive' };

    const keypair = this.getPredictKeypair();
    if (!keypair) return { success: false, error: 'Predict treasury keypair not configured' };

    const walletAddr = keypair.toSuiAddress();
    console.log(`${label} Sending ${amount} ${currency} from predict wallet ${walletAddr.slice(0,12)}... -> ${recipientAddress.slice(0,10)}...`);

    try {
      const { treasuryGuard } = await import('./treasuryGuardService');
      const guardCheck = treasuryGuard.check(amount, currency, recipientAddress, 'predict_payout');
      if (!guardCheck.allowed) {
        treasuryGuard.recordBlocked(amount, currency, recipientAddress, 'predict_payout', guardCheck.reason || 'guard');
        return { success: false, error: guardCheck.reason || 'Treasury guard blocked predict payout' };
      }

      const tx = new Transaction();

      if (currency === 'SUI') {
        const bal = await this.getWalletBalance(walletAddr);
        if (bal.sui < amount + 0.01) return { success: false, error: `Insufficient SUI in predict wallet: ${bal.sui.toFixed(4)}` };
        const [coin] = tx.splitCoins(tx.gas, [BigInt(Math.floor(amount * 1e9))]);
        tx.transferObjects([coin], recipientAddress);
      } else if (currency === 'USDSUI') {
        const coins = await this.client.getCoins({ owner: walletAddr, coinType: USDSUI_COIN_TYPE });
        if (!coins.data?.length) return { success: false, error: 'No USDsui in predict wallet' };
        const totalBal = coins.data.reduce((s, c) => s + BigInt(c.balance), BigInt(0));
        const needed = BigInt(Math.floor(amount * 1e6));
        if (totalBal < needed) return { success: false, error: `Insufficient USDsui in predict wallet` };
        const coinIds = coins.data.map(c => c.coinObjectId);
        const primaryCoin = tx.object(coinIds[0]);
        if (coinIds.length > 1) tx.mergeCoins(primaryCoin, coinIds.slice(1).map(id => tx.object(id)));
        const [pay] = tx.splitCoins(primaryCoin, [needed]);
        tx.transferObjects([pay], recipientAddress);
      } else {
        const coins = await this.client.getCoins({ owner: walletAddr, coinType: this.sbetsTokenType });
        if (!coins.data?.length) return { success: false, error: 'No SBETS in predict wallet' };
        const totalBal = coins.data.reduce((s, c) => s + BigInt(c.balance), BigInt(0));
        const needed = BigInt(Math.floor(amount * 1e9));
        if (totalBal < needed) return { success: false, error: `Insufficient SBETS in predict wallet` };
        const coinIds = coins.data.map(c => c.coinObjectId);
        const primaryCoin = tx.object(coinIds[0]);
        if (coinIds.length > 1) tx.mergeCoins(primaryCoin, coinIds.slice(1).map(id => tx.object(id)));
        const [pay] = tx.splitCoins(primaryCoin, [needed]);
        tx.transferObjects([pay], recipientAddress);
      }

      const result = await this.client.signAndExecuteTransaction({
        signer: keypair, transaction: tx, options: { showEffects: true },
      });

      if (result.effects?.status?.status === 'success') {
        treasuryGuard.record(amount, currency, recipientAddress, 'predict_payout', result.digest);
        console.log(`${label} ✅ ${amount} ${currency} -> ${recipientAddress.slice(0,10)}... | TX: ${result.digest}`);
        return { success: true, txHash: result.digest };
      }
      return { success: false, error: result.effects?.status?.error || 'Transaction failed' };
    } catch (err: any) {
      console.error(`${label} ❌ Failed:`, err.message);
      return { success: false, error: err.message };
    }
  }

  async verifyPredictDeposit(txHash: string, expectedSender: string, expectedAmount: number, currency: string): Promise<{
    verified: boolean; sender?: string; amount?: number; error?: string;
  }> {
    const predictWallet = this.getPredictTreasuryWallet().toLowerCase();
    const MAX_RETRIES = 5;
    const RETRY_DELAYS = [2000, 3000, 4000, 5000, 6000];
    let lastError = '';

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        if (attempt > 0) {
          await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt - 1] || 6000));
        }

        const opts = { showEffects: true, showBalanceChanges: true, showInput: true, showObjectChanges: true };
        let txResp;
        try {
          txResp = await this.client.waitForTransaction({ digest: txHash, timeout: 10000, pollInterval: 1500, options: opts });
        } catch {
          txResp = await this.client.getTransactionBlock({ digest: txHash, options: opts });
        }

        if (!txResp) { lastError = 'TX not found'; continue; }
        if (txResp.effects?.status?.status !== 'success') return { verified: false, error: 'TX failed on-chain' };

        const sender = txResp.transaction?.data?.sender;
        if (!sender || sender.toLowerCase() !== expectedSender.toLowerCase()) {
          return { verified: false, error: `Sender mismatch` };
        }

        const balanceChanges = txResp.balanceChanges || [];
        let exactCoinType: string;
        let decimals: number;
        if (currency === 'SUI') { exactCoinType = '0x2::sui::SUI'; decimals = 9; }
        else if (currency === 'USDSUI') { exactCoinType = USDSUI_COIN_TYPE; decimals = 6; }
        else { exactCoinType = SBETS_COIN_TYPE; decimals = 9; }

        const tokenChanges = balanceChanges.filter((bc: any) => bc.coinType === exactCoinType);
        if (tokenChanges.length > 0) {
          const walletReceive = tokenChanges.find((bc: any) =>
            bc.owner?.AddressOwner?.toLowerCase() === predictWallet && BigInt(bc.amount) > 0
          );

          if (!walletReceive) {
            return { verified: false, error: `${currency} not sent to predict treasury wallet` };
          }

          const received = Number(BigInt(walletReceive.amount)) / Math.pow(10, decimals);
          if (received < expectedAmount * 0.99) {
            return { verified: false, error: `Amount too low: expected ${expectedAmount}, received ${received} ${currency}` };
          }

          console.log(`[PREDICT-VERIFY] ✅ ${currency} deposit verified: ${sender.slice(0,10)}... -> predict wallet | ${received} ${currency} | TX: ${txHash}`);
          return { verified: true, sender, amount: received };
        }

        lastError = `No ${currency} transfer found in TX`;
        if (attempt < MAX_RETRIES - 1) continue;
        return { verified: false, error: lastError };
      } catch (err: any) {
        lastError = err.message;
        if (attempt === MAX_RETRIES - 1) return { verified: false, error: lastError };
      }
    }
    return { verified: false, error: lastError };
  }

  async createPredictionMarket(
    title: string, description: string, category: string,
    endTimeMs: number, initialLiquidity: number, feeBps: number,
    maxBet: number, currency: string
  ): Promise<{ success: boolean; marketObjectId?: string; txHash?: string; error?: string }> {
    const keypair = this.getAdminKeypair();
    if (!keypair) return { success: false, error: 'Admin keypair not configured' };

    const coinType = getPredictCoinType(currency);
    const decimals = getPredictDecimals(currency);
    const liqSmallest = BigInt(Math.floor(initialLiquidity * Math.pow(10, decimals)));
    const maxBetSmallest = BigInt(Math.floor(maxBet * Math.pow(10, decimals)));

    try {
      const tx = new Transaction();
      tx.moveCall({
        target: `${PREDICTION_PACKAGE_ID}::prediction_market::create_market`,
        typeArguments: [coinType],
        arguments: [
          tx.object(PREDICTION_ADMIN_CAP_ID),
          tx.object(PREDICTION_PLATFORM_CONFIG_ID),
          tx.pure.vector('u8', Array.from(new TextEncoder().encode(title.slice(0, 200)))),
          tx.pure.vector('u8', Array.from(new TextEncoder().encode((description || '').slice(0, 1000)))),
          tx.pure.vector('u8', Array.from(new TextEncoder().encode(category))),
          tx.pure.u64(endTimeMs),
          tx.pure.u64(liqSmallest),
          tx.pure.u64(feeBps),
          tx.pure.u64(maxBetSmallest),
          tx.object(SUI_CLOCK_ID),
        ],
      });

      const result = await this.client.signAndExecuteTransaction({
        signer: keypair, transaction: tx,
        options: { showEffects: true, showEvents: true, showObjectChanges: true },
      });

      if (result.effects?.status?.status !== 'success') {
        return { success: false, error: result.effects?.status?.error || 'Create market TX failed' };
      }

      const created = (result.objectChanges as any[])?.find(
        (c: any) => c.type === 'created' && c.objectType?.startsWith(`${PREDICTION_PACKAGE_ID}::prediction_market::Market`)
      );
      if (!created || !('objectId' in created)) {
        return { success: false, error: 'Market object not found in TX result' };
      }

      console.log(`[PREDICT-CONTRACT] ✅ Market created on-chain: ${created.objectId} | ${currency} | TX: ${result.digest}`);
      return { success: true, marketObjectId: created.objectId, txHash: result.digest };
    } catch (err: any) {
      console.error(`[PREDICT-CONTRACT] ❌ Create market failed:`, err.message);
      return { success: false, error: err.message };
    }
  }

  async resolveOnchainMarket(
    marketObjectId: string, outcome: 'yes' | 'no', currency: string
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    const keypair = this.getAdminKeypair();
    if (!keypair) return { success: false, error: 'Admin keypair not configured' };

    const coinType = getPredictCoinType(currency);
    const outcomeU8 = outcome === 'yes' ? 2 : 3;

    try {
      const tx = new Transaction();
      tx.moveCall({
        target: `${PREDICTION_PACKAGE_ID}::prediction_market::resolve_market_direct`,
        typeArguments: [coinType],
        arguments: [
          tx.object(PREDICTION_ADMIN_CAP_ID),
          tx.object(PREDICTION_PLATFORM_CONFIG_ID),
          tx.object(marketObjectId),
          tx.pure.u8(outcomeU8),
          tx.object(SUI_CLOCK_ID),
        ],
      });

      const result = await this.client.signAndExecuteTransaction({
        signer: keypair, transaction: tx,
        options: { showEffects: true, showEvents: true },
      });

      if (result.effects?.status?.status !== 'success') {
        return { success: false, error: result.effects?.status?.error || 'Resolve TX failed' };
      }

      console.log(`[PREDICT-CONTRACT] ✅ Market resolved on-chain: ${marketObjectId} → ${outcome.toUpperCase()} | TX: ${result.digest}`);
      return { success: true, txHash: result.digest };
    } catch (err: any) {
      console.error(`[PREDICT-CONTRACT] ❌ Resolve market failed:`, err.message);
      return { success: false, error: err.message };
    }
  }

  async cancelOnchainMarket(
    marketObjectId: string, currency: string
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    const keypair = this.getAdminKeypair();
    if (!keypair) return { success: false, error: 'Admin keypair not configured' };

    const coinType = getPredictCoinType(currency);

    try {
      const tx = new Transaction();
      tx.moveCall({
        target: `${PREDICTION_PACKAGE_ID}::prediction_market::cancel_market`,
        typeArguments: [coinType],
        arguments: [
          tx.object(PREDICTION_ADMIN_CAP_ID),
          tx.object(marketObjectId),
        ],
      });

      const result = await this.client.signAndExecuteTransaction({
        signer: keypair, transaction: tx,
        options: { showEffects: true },
      });

      if (result.effects?.status?.status !== 'success') {
        return { success: false, error: result.effects?.status?.error || 'Cancel TX failed' };
      }

      console.log(`[PREDICT-CONTRACT] ✅ Market cancelled on-chain: ${marketObjectId} | TX: ${result.digest}`);
      return { success: true, txHash: result.digest };
    } catch (err: any) {
      console.error(`[PREDICT-CONTRACT] ❌ Cancel market failed:`, err.message);
      return { success: false, error: err.message };
    }
  }

  async setMarketMaxBet(
    marketObjectId: string, maxBet: number, currency: string
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    const keypair = this.getAdminKeypair();
    if (!keypair) return { success: false, error: 'Admin keypair not configured' };
    const coinType = getPredictCoinType(currency);
    const decimals = getPredictDecimals(currency);
    const maxBetSmallest = BigInt(Math.floor(maxBet * Math.pow(10, decimals)));
    try {
      const tx = new Transaction();
      tx.moveCall({
        target: `${PREDICTION_PACKAGE_ID}::prediction_market::set_market_max_bet`,
        typeArguments: [coinType],
        arguments: [
          tx.object(PREDICTION_ADMIN_CAP_ID),
          tx.object(marketObjectId),
          tx.pure.u64(maxBetSmallest),
        ],
      });
      const result = await this.client.signAndExecuteTransaction({
        signer: keypair, transaction: tx,
        options: { showEffects: true },
      });
      if (result.effects?.status?.status !== 'success') {
        return { success: false, error: result.effects?.status?.error || 'set_market_max_bet TX failed' };
      }
      console.log(`[PREDICT-CONTRACT] ✅ Max bet updated: ${marketObjectId} → ${maxBet} ${currency} | TX: ${result.digest}`);
      return { success: true, txHash: result.digest };
    } catch (err: any) {
      console.error(`[PREDICT-CONTRACT] ❌ Set max bet failed:`, err.message);
      return { success: false, error: err.message };
    }
  }

  async getOnchainMarketState(marketObjectId: string, currency: string): Promise<{
    success: boolean;
    yesReserve?: number;
    noReserve?: number;
    totalVolume?: number;
    participantCount?: number;
    totalYesShares?: number;
    totalNoShares?: number;
    status?: number;
    initialLiquidity?: number;
    treasuryBalance?: number;
    feeBps?: number;
    endTime?: number;
    maxBet?: number;
    yesPrice?: number;
    noPrice?: number;
    error?: string;
  }> {
    try {
      const obj = await this.client.getObject({
        id: marketObjectId,
        options: { showContent: true, showType: true },
      });
      if (!obj.data?.content || obj.data.content.dataType !== 'moveObject') {
        return { success: false, error: 'Market object not found or not a Move object' };
      }
      const fields = (obj.data.content as any).fields;
      if (!fields) return { success: false, error: 'No fields in market object' };

      const objectType = (obj.data.content as any).type || '';
      let detectedCurrency = currency;
      if (objectType.includes('::sui::SUI')) detectedCurrency = 'SUI';
      else if (objectType.includes('::sbets::SBETS')) detectedCurrency = 'SBETS';
      else if (objectType.includes('::usdsui::USDSUI')) detectedCurrency = 'USDSUI';

      const decimals = getPredictDecimals(detectedCurrency);
      const divisor = BigInt(10 ** decimals);
      const safeDivide = (raw: string | number | bigint): number => {
        const big = BigInt(raw || 0);
        const whole = big / divisor;
        const frac = big % divisor;
        return Number(whole) + Number(frac) / Number(divisor);
      };
      const yesR = safeDivide(fields.yes_reserve || 0);
      const noR = safeDivide(fields.no_reserve || 0);
      const total = yesR + noR;
      const yesPrice = total > 0 ? noR / total : 0.5;
      const noPrice = total > 0 ? yesR / total : 0.5;

      return {
        success: true,
        yesReserve: yesR,
        noReserve: noR,
        totalVolume: safeDivide(fields.total_volume || 0),
        participantCount: Number(fields.participant_count || 0),
        totalYesShares: safeDivide(fields.total_yes_shares || 0),
        totalNoShares: safeDivide(fields.total_no_shares || 0),
        status: Number(fields.status || 0),
        initialLiquidity: safeDivide(fields.initial_liquidity || 0),
        treasuryBalance: safeDivide(fields.treasury?.fields?.value || fields.treasury || 0),
        feeBps: Number(fields.fee_bps || 0),
        endTime: Number(fields.end_time || 0),
        maxBet: safeDivide(fields.max_bet || 0),
        yesPrice,
        noPrice,
      };
    } catch (err: any) {
      console.error(`[PREDICT-CONTRACT] ❌ Get market state failed:`, err.message);
      return { success: false, error: err.message };
    }
  }

  async verifySharesPurchased(txHash: string, expectedBuyer: string): Promise<{
    verified: boolean;
    marketId?: string;
    buyer?: string;
    side?: number;
    amountPaid?: number;
    sharesReceived?: number;
    feePaid?: number;
    yesPriceAfter?: number;
    noPriceAfter?: number;
    error?: string;
  }> {
    const MAX_RETRIES = 5;
    const RETRY_DELAYS = [2000, 3000, 4000, 5000, 6000];
    let lastError = '';

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt - 1]));
      try {
        let txResp;
        try {
          txResp = await this.client.waitForTransaction({ digest: txHash, timeout: 10000, pollInterval: 1500, options: { showEvents: true, showEffects: true, showInput: true } });
        } catch {
          txResp = await this.client.getTransactionBlock({ digest: txHash, options: { showEvents: true, showEffects: true, showInput: true } });
        }

        if (!txResp) { lastError = 'TX not found'; continue; }
        if (txResp.effects?.status?.status !== 'success') return { verified: false, error: 'Transaction failed on-chain' };

        const sender = txResp.transaction?.data?.sender;
        if (sender && sender.toLowerCase() !== expectedBuyer.toLowerCase()) {
          return { verified: false, error: 'Sender does not match expected buyer' };
        }

        const buyEvent = (txResp.events || []).find(
          (e: any) => e.type === `${PREDICTION_PACKAGE_ID}::prediction_market::SharesPurchased`
        );

        if (!buyEvent) {
          lastError = 'SharesPurchased event not found in TX';
          if (attempt < MAX_RETRIES - 1) continue;
          return { verified: false, error: lastError };
        }

        const f = buyEvent.parsedJson as any;
        console.log(`[PREDICT-VERIFY] ✅ SharesPurchased: buyer=${f.buyer?.slice(0,10)}... side=${f.side} amount=${f.amount_paid} shares=${f.shares_received} | TX: ${txHash}`);
        return {
          verified: true,
          marketId: f.market_id,
          buyer: f.buyer,
          side: Number(f.side),
          amountPaid: Number(f.amount_paid),
          sharesReceived: Number(f.shares_received),
          feePaid: Number(f.fee_paid),
          yesPriceAfter: Number(f.yes_price_after),
          noPriceAfter: Number(f.no_price_after),
        };
      } catch (err: any) {
        lastError = err.message;
        if (attempt === MAX_RETRIES - 1) return { verified: false, error: lastError };
      }
    }
    return { verified: false, error: lastError };
  }

  async verifySharesSold(txHash: string, expectedSeller: string): Promise<{
    verified: boolean;
    marketId?: string;
    seller?: string;
    side?: number;
    sharesSold?: number;
    amountReceived?: number;
    feePaid?: number;
    yesPriceAfter?: number;
    noPriceAfter?: number;
    error?: string;
  }> {
    const MAX_RETRIES = 5;
    const RETRY_DELAYS = [2000, 3000, 4000, 5000, 6000];
    let lastError = '';

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt - 1]));
      try {
        let txResp;
        try {
          txResp = await this.client.waitForTransaction({ digest: txHash, timeout: 10000, pollInterval: 1500, options: { showEvents: true, showEffects: true, showInput: true } });
        } catch {
          txResp = await this.client.getTransactionBlock({ digest: txHash, options: { showEvents: true, showEffects: true, showInput: true } });
        }

        if (!txResp) { lastError = 'TX not found'; continue; }
        if (txResp.effects?.status?.status !== 'success') return { verified: false, error: 'Transaction failed on-chain' };

        const sender = txResp.transaction?.data?.sender;
        if (sender && sender.toLowerCase() !== expectedSeller.toLowerCase()) {
          return { verified: false, error: 'Sender does not match expected seller' };
        }

        const sellEvent = (txResp.events || []).find(
          (e: any) => e.type === `${PREDICTION_PACKAGE_ID}::prediction_market::SharesSold`
        );

        if (!sellEvent) {
          lastError = 'SharesSold event not found in TX';
          if (attempt < MAX_RETRIES - 1) continue;
          return { verified: false, error: lastError };
        }

        const f = sellEvent.parsedJson as any;
        console.log(`[PREDICT-VERIFY] ✅ SharesSold: seller=${f.seller?.slice(0,10)}... side=${f.side} shares=${f.shares_sold} payout=${f.amount_received} | TX: ${txHash}`);
        return {
          verified: true,
          marketId: f.market_id,
          seller: f.seller,
          side: Number(f.side),
          sharesSold: Number(f.shares_sold),
          amountReceived: Number(f.amount_received),
          feePaid: Number(f.fee_paid),
          yesPriceAfter: Number(f.yes_price_after),
          noPriceAfter: Number(f.no_price_after),
        };
      } catch (err: any) {
        lastError = err.message;
        if (attempt === MAX_RETRIES - 1) return { verified: false, error: lastError };
      }
    }
    return { verified: false, error: lastError };
  }

  async verifyWinningsClaimed(txHash: string): Promise<{
    verified: boolean;
    marketId?: string;
    claimer?: string;
    winningShares?: number;
    payout?: number;
    error?: string;
  }> {
    const MAX_RETRIES = 5;
    const RETRY_DELAYS = [2000, 3000, 4000, 5000, 6000];
    let lastError = '';

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt - 1]));
      try {
        let txResp;
        try {
          txResp = await this.client.waitForTransaction({ digest: txHash, timeout: 10000, pollInterval: 1500, options: { showEvents: true, showEffects: true } });
        } catch {
          txResp = await this.client.getTransactionBlock({ digest: txHash, options: { showEvents: true, showEffects: true } });
        }

        if (!txResp) { lastError = 'TX not found'; continue; }
        if (txResp.effects?.status?.status !== 'success') return { verified: false, error: 'Transaction failed on-chain' };

        // Try all event name variants (contract may use different casing/names)
        const EVENT_VARIANTS = [
          `${PREDICTION_PACKAGE_ID}::prediction_market::WinningsClaimed`,
          `${PREDICTION_PACKAGE_ID}::prediction_market::Claimed`,
          `${PREDICTION_PACKAGE_ID}::prediction_market::PayoutClaimed`,
          `${PREDICTION_PACKAGE_ID}::prediction_market::WinClaimed`,
        ];
        const claimEvent = (txResp.events || []).find(
          (e: any) => EVENT_VARIANTS.includes(e.type)
        );

        if (claimEvent) {
          const f = claimEvent.parsedJson as any;
          return {
            verified: true,
            marketId: f.market_id,
            claimer: f.claimer || txResp.transaction?.data?.sender,
            winningShares: Number(f.winning_shares || f.shares || 0),
            payout: Number(f.payout || f.amount || 0),
          };
        }

        // Fallback: tx succeeded — infer payout from positive balance changes to the sender
        // This handles cases where the event is not yet indexed or uses an unexpected name
        if (attempt === MAX_RETRIES - 1) {
          const sender: string = txResp.transaction?.data?.sender || '';
          const balanceChanges: any[] = txResp.balanceChanges || [];
          const senderGain = balanceChanges.find(
            (bc: any) =>
              (bc.owner?.AddressOwner || '').toLowerCase() === sender.toLowerCase() &&
              BigInt(bc.amount || 0) > 0n &&
              !bc.coinType?.includes('::sui::SUI'), // ignore SUI gas refunds
          );
          if (senderGain) {
            console.warn(`[VerifyClaim] WinningsClaimed event not found for TX ${txHash.slice(0,12)}… — using balance-change fallback. Payout: ${senderGain.amount}`);
            return {
              verified: true,
              claimer: sender,
              payout: Number(senderGain.amount),
            };
          }
          // Last resort: tx succeeded and sender is known — accept it and let the amount be 0
          if (sender) {
            console.warn(`[VerifyClaim] No event or balance gain found for TX ${txHash.slice(0,12)}… — accepting on tx success`);
            return { verified: true, claimer: sender, payout: 0 };
          }
          return { verified: false, error: 'WinningsClaimed event not found and no balance change detected' };
        }

        lastError = 'WinningsClaimed event not found';
        continue;
      } catch (err: any) {
        lastError = err.message;
        if (attempt === MAX_RETRIES - 1) return { verified: false, error: lastError };
      }
    }
    return { verified: false, error: lastError };
  }

  async verifyRefundClaimed(txHash: string): Promise<{
    verified: boolean;
    marketId?: string;
    claimer?: string;
    refund?: number;
    error?: string;
  }> {
    const MAX_RETRIES = 5;
    const RETRY_DELAYS = [2000, 3000, 4000, 5000, 6000];
    let lastError = '';

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt - 1]));
      try {
        let txResp;
        try {
          txResp = await this.client.waitForTransaction({ digest: txHash, timeout: 10000, pollInterval: 1500, options: { showEvents: true, showEffects: true } });
        } catch {
          txResp = await this.client.getTransactionBlock({ digest: txHash, options: { showEvents: true, showEffects: true } });
        }

        if (!txResp) { lastError = 'TX not found'; continue; }
        if (txResp.effects?.status?.status !== 'success') return { verified: false, error: 'Transaction failed on-chain' };

        const refundEvent = (txResp.events || []).find(
          (e: any) => e.type === `${PREDICTION_PACKAGE_ID}::prediction_market::RefundClaimed`
        );

        if (!refundEvent) {
          lastError = 'RefundClaimed event not found';
          if (attempt < MAX_RETRIES - 1) continue;
          return { verified: false, error: lastError };
        }

        const f = refundEvent.parsedJson as any;
        return {
          verified: true,
          marketId: f.market_id,
          claimer: f.claimer,
          refund: Number(f.refund),
        };
      } catch (err: any) {
        lastError = err.message;
        if (attempt === MAX_RETRIES - 1) return { verified: false, error: lastError };
      }
    }
    return { verified: false, error: lastError };
  }

  async readOnchainMarket(marketObjectId: string): Promise<{
    success: boolean;
    yesReserve?: number;
    noReserve?: number;
    totalVolume?: number;
    status?: number;
    treasuryValue?: number;
    totalYesShares?: number;
    totalNoShares?: number;
    error?: string;
  }> {
    try {
      const obj = await this.client.getObject({
        id: marketObjectId,
        options: { showContent: true },
      });
      if (!obj?.data?.content || obj.data.content.dataType !== 'moveObject') {
        return { success: false, error: 'Market object not found' };
      }
      const fields = (obj.data.content as any).fields;
      return {
        success: true,
        yesReserve: Number(fields.yes_reserve),
        noReserve: Number(fields.no_reserve),
        totalVolume: Number(fields.total_volume),
        status: Number(fields.status),
        treasuryValue: typeof fields.treasury === 'object' ? Number(fields.treasury.fields?.value || 0) : Number(fields.treasury || 0),
        totalYesShares: Number(fields.total_yes_shares),
        totalNoShares: Number(fields.total_no_shares),
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  getPredictionPackageId(): string { return PREDICTION_PACKAGE_ID; }
  getPredictionPlatformConfigId(): string { return PREDICTION_PLATFORM_CONFIG_ID; }

  async sendSbetsFromRevenueWallet(recipientAddress: string, amount: number): Promise<{ success: boolean; txHash?: string; error?: string }> {
    try {
      const { treasuryGuard } = await import('./treasuryGuardService');
      const guardCheck = treasuryGuard.check(amount, 'SBETS', recipientAddress, 'payout');
      if (!guardCheck.allowed) {
        treasuryGuard.recordBlocked(amount, 'SBETS', recipientAddress, 'payout', guardCheck.reason || 'guard');
        return { success: false, error: guardCheck.reason || 'Treasury guard blocked this transfer' };
      }
      if (guardCheck.delayed && guardCheck.delayMs) {
        await new Promise(resolve => setTimeout(resolve, guardCheck.delayMs));
        if (treasuryGuard.isFrozen()) {
          return { success: false, error: 'Treasury was frozen during delay period' };
        }
      }

      const keypair = this.getRevenueKeypair();
      if (!keypair) {
        return { success: false, error: 'Revenue wallet keypair not configured' };
      }

      if (amount <= 0) {
        return { success: false, error: 'Amount must be positive' };
      }

      const revenueAddress = keypair.toSuiAddress();
      const adminBalance = await this.getWalletBalance(revenueAddress);
      if (adminBalance.sui < 0.01) {
        return { success: false, error: `Insufficient gas in revenue wallet: ${adminBalance.sui.toFixed(4)} SUI` };
      }

      const amountInSmallest = BigInt(Math.floor(amount * 1_000_000_000));
      const tx = new Transaction();

      const coins = await this.client.getCoins({
        owner: revenueAddress,
        coinType: this.sbetsTokenType,
      });

      if (!coins.data || coins.data.length === 0) {
        return { success: false, error: 'No SBETS in revenue wallet - needs funding' };
      }

      const totalBalance = coins.data.reduce((sum, c) => sum + BigInt(c.balance), BigInt(0));
      if (totalBalance < amountInSmallest) {
        return { success: false, error: `Insufficient SBETS in revenue wallet: ${Number(totalBalance) / 1_000_000_000} < ${amount}` };
      }

      const coinIds = coins.data.map(c => c.coinObjectId);
      if (coinIds.length > 1) {
        tx.mergeCoins(coinIds[0], coinIds.slice(1));
      }

      const [paymentCoin] = tx.splitCoins(coinIds[0], [amountInSmallest]);
      tx.transferObjects([paymentCoin], recipientAddress);

      const result = await this.client.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx,
        options: { showEffects: true },
      });

      if (result.effects?.status?.status === 'success') {
        treasuryGuard.record(amount, 'SBETS', recipientAddress, 'payout', result.digest);
        console.log(`💸 SBETS REVENUE PAYOUT: ${amount} SBETS -> ${recipientAddress.slice(0,10)}... | TX: ${result.digest}`);
        return { success: true, txHash: result.digest };
      } else {
        return { success: false, error: result.effects?.status?.error || 'Transaction failed' };
      }
    } catch (error: any) {
      console.error(`❌ Failed to send SBETS from revenue wallet:`, error.message);
      return { success: false, error: error.message };
    }
  }

  async sendSuiFromRevenueWallet(recipientAddress: string, amount: number): Promise<{ success: boolean; txHash?: string; error?: string }> {
    try {
      const { treasuryGuard } = await import('./treasuryGuardService');
      const guardCheck = treasuryGuard.check(amount, 'SUI', recipientAddress, 'payout');
      if (!guardCheck.allowed) {
        treasuryGuard.recordBlocked(amount, 'SUI', recipientAddress, 'payout', guardCheck.reason || 'guard');
        return { success: false, error: guardCheck.reason || 'Treasury guard blocked this transfer' };
      }
      if (guardCheck.delayed && guardCheck.delayMs) {
        await new Promise(resolve => setTimeout(resolve, guardCheck.delayMs));
        if (treasuryGuard.isFrozen()) {
          return { success: false, error: 'Treasury was frozen during delay period' };
        }
      }

      const keypair = this.getRevenueKeypair();
      if (!keypair) {
        return { success: false, error: 'Revenue wallet keypair not configured' };
      }

      if (amount <= 0) {
        return { success: false, error: 'Amount must be positive' };
      }

      const revenueAddress = keypair.toSuiAddress();
      const walletBalance = await this.getWalletBalance(revenueAddress);
      const totalNeeded = amount + 0.01;
      if (walletBalance.sui < totalNeeded) {
        return { success: false, error: `Insufficient SUI in revenue wallet: ${walletBalance.sui.toFixed(4)} < ${totalNeeded.toFixed(4)}` };
      }

      const tx = new Transaction();
      const amountInMist = BigInt(Math.floor(amount * 1_000_000_000));
      const [coin] = tx.splitCoins(tx.gas, [amountInMist]);
      tx.transferObjects([coin], recipientAddress);

      const result = await this.client.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx,
        options: { showEffects: true },
      });

      if (result.effects?.status?.status === 'success') {
        treasuryGuard.record(amount, 'SUI', recipientAddress, 'payout', result.digest);
        console.log(`💸 SUI REVENUE PAYOUT: ${amount} SUI -> ${recipientAddress.slice(0,10)}... | TX: ${result.digest}`);
        return { success: true, txHash: result.digest };
      } else {
        return { success: false, error: result.effects?.status?.error || 'Transaction failed' };
      }
    } catch (error: any) {
      console.error(`❌ Failed to send SUI from revenue wallet:`, error.message);
      return { success: false, error: error.message };
    }
  }

  // Execute on-chain SUI payout to user (for withdrawals)
  // Returns explicit error if keypair loading fails
  async executePayoutOnChain(
    recipientAddress: string,
    amountSui: number
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    if (!amountSui || amountSui <= 0) {
      console.warn(`⚠️ PAYOUT SKIPPED: Zero or negative amount (${amountSui} SUI) to ${recipientAddress}`);
      return { success: false, error: 'Amount must be positive - skipping zero-value transaction' };
    }

    const keypair = this.getAdminKeypair();
    if (!keypair) {
      const error = 'Admin private key not configured or invalid format';
      console.error(`❌ PAYOUT BLOCKED: ${error}`);
      return { success: false, error };
    }

    try {
      const amountMist = Math.floor(amountSui * 1e9);
      
      const tx = new Transaction();
      const [coin] = tx.splitCoins(tx.gas, [amountMist]);
      tx.transferObjects([coin], recipientAddress);

      const result = await this.client.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx,
        options: {
          showEffects: true,
          showEvents: true,
        },
      });

      if (result.effects?.status?.status === 'success') {
        console.log(`✅ ON-CHAIN PAYOUT: ${amountSui} SUI to ${recipientAddress} | TX: ${result.digest}`);
        return { success: true, txHash: result.digest };
      } else {
        console.error(`❌ PAYOUT FAILED: ${result.effects?.status?.error || 'Unknown error'}`);
        return { success: false, error: result.effects?.status?.error || 'Transaction failed' };
      }
    } catch (error: any) {
      console.error('❌ Payout execution error:', error);
      return { success: false, error: error.message || 'Failed to execute payout' };
    }
  }

  /**
   * Execute on-chain SBETS payout to recipient
   * Requires admin wallet to have SBETS tokens
   */
  async executePayoutSbetsOnChain(
    recipientAddress: string,
    amountSbets: number
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    if (!amountSbets || amountSbets <= 0) {
      console.warn(`⚠️ SBETS PAYOUT SKIPPED: Zero or negative amount (${amountSbets} SBETS) to ${recipientAddress}`);
      return { success: false, error: 'Amount must be positive - skipping zero-value transaction' };
    }

    const keypair = this.getAdminKeypair();
    if (!keypair) {
      const error = 'Admin private key not configured or invalid format';
      console.error(`❌ SBETS PAYOUT BLOCKED: ${error}`);
      return { success: false, error };
    }

    try {
      const amountMist = Math.floor(amountSbets * 1e9);
      const adminAddress = keypair.toSuiAddress();
      
      // Get admin's SBETS coins
      const sbetsCoins = await this.client.getCoins({
        owner: adminAddress,
        coinType: SBETS_COIN_TYPE,
      });

      if (!sbetsCoins.data || sbetsCoins.data.length === 0) {
        return { success: false, error: 'No SBETS coins available in admin wallet' };
      }

      const tx = new Transaction();
      
      // Merge all SBETS coins if multiple exist
      if (sbetsCoins.data.length > 1) {
        const primaryCoin = tx.object(sbetsCoins.data[0].coinObjectId);
        const coinsToMerge = sbetsCoins.data.slice(1).map(c => tx.object(c.coinObjectId));
        tx.mergeCoins(primaryCoin, coinsToMerge);
        const [splitCoin] = tx.splitCoins(primaryCoin, [amountMist]);
        tx.transferObjects([splitCoin], recipientAddress);
      } else {
        const primaryCoin = tx.object(sbetsCoins.data[0].coinObjectId);
        const [splitCoin] = tx.splitCoins(primaryCoin, [amountMist]);
        tx.transferObjects([splitCoin], recipientAddress);
      }

      const result = await this.client.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx,
        options: {
          showEffects: true,
          showEvents: true,
        },
      });

      if (result.effects?.status?.status === 'success') {
        console.log(`✅ ON-CHAIN SBETS PAYOUT: ${amountSbets} SBETS to ${recipientAddress} | TX: ${result.digest}`);
        return { success: true, txHash: result.digest };
      } else {
        console.error(`❌ SBETS PAYOUT FAILED: ${result.effects?.status?.error || 'Unknown error'}`);
        return { success: false, error: result.effects?.status?.error || 'Transaction failed' };
      }
    } catch (error: any) {
      console.error('❌ SBETS Payout execution error:', error);
      return { success: false, error: error.message || 'Failed to execute SBETS payout' };
    }
  }

  private sbetsTokenType = SBETS_COIN_TYPE;

  // Get treasury balance (admin wallet balance)
  async getTreasuryBalance(): Promise<{ sui: number; sbets: number }> {
    return this.getWalletBalance(PLATFORM_REVENUE_WALLET);
  }

  /**
   * Execute on-chain bet settlement via smart contract
   * Calls the settle_bet function which pays winners directly from contract treasury
   * @param betObjectId - The on-chain Bet object ID
   * @param won - Whether the bet won or lost
   * @returns Transaction result with hash or error
   */
  async executeSettleBetOnChain(
    betObjectId: string,
    won: boolean
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    const keypair = this.getAdminKeypair();
    if (!keypair) {
      const error = 'Admin private key not configured - cannot execute on-chain settlement';
      console.error(`❌ SETTLEMENT BLOCKED: ${error}`);
      return { success: false, error };
    }

    if (!ADMIN_CAP_ID) {
      const error = 'ADMIN_CAP_ID not configured - cannot execute on-chain settlement with capability pattern';
      console.error(`❌ SETTLEMENT BLOCKED: ${error}`);
      return { success: false, error };
    }

    try {
      const betObj = await this.client.getObject({ id: betObjectId, options: { showOwner: true } });
      const owner = betObj.data?.owner;
      if (owner && typeof owner === 'object' && 'AddressOwner' in owner) {
        return { success: false, error: `Bet object is owned by ${(owner as any).AddressOwner.slice(0,12)}... - cannot settle owned objects` };
      }

      const adminBalance = await this.getWalletBalance(keypair.toSuiAddress());
      if (adminBalance.sui < 0.01) {
        return { success: false, error: `Admin wallet too low for gas: ${adminBalance.sui.toFixed(4)} SUI` };
      }

      const tx = new Transaction();
      
      tx.moveCall({
        target: `${BETTING_PACKAGE_ID}::betting::settle_bet_admin`,
        arguments: [
          tx.object(ADMIN_CAP_ID),
          tx.object(BETTING_PLATFORM_ID),
          tx.object(betObjectId),
          tx.pure.bool(won),
          tx.object('0x6'),
        ],
      });

      const result = await this.client.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx,
        options: {
          showEffects: true,
          showEvents: true,
        },
      });

      if (result.effects?.status?.status === 'success') {
        const outcome = won ? 'WON (payout sent)' : 'LOST (stake kept in treasury)';
        console.log(`✅ ON-CHAIN SETTLEMENT: Bet ${betObjectId.slice(0, 12)}... ${outcome} | TX: ${result.digest}`);
        return { success: true, txHash: result.digest };
      } else {
        const errorMsg = result.effects?.status?.error || 'Unknown error';
        console.error(`❌ ON-CHAIN SETTLEMENT FAILED: ${errorMsg}`);
        return { success: false, error: errorMsg };
      }
    } catch (error: any) {
      console.error('❌ Settlement execution error:', error);
      return { success: false, error: error.message || 'Failed to execute on-chain settlement' };
    }
  }

  /**
   * Execute on-chain bet void via smart contract
   * Calls the void_bet function which refunds the bettor
   * @param betObjectId - The on-chain Bet object ID
   * @returns Transaction result with hash or error
   */
  async executeVoidBetOnChain(
    betObjectId: string
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    const keypair = this.getAdminKeypair();
    if (!keypair) {
      const error = 'Admin private key not configured - cannot execute on-chain void';
      console.error(`❌ VOID BLOCKED: ${error}`);
      return { success: false, error };
    }

    if (!ADMIN_CAP_ID) {
      return { success: false, error: 'ADMIN_CAP_ID not configured' };
    }

    try {
      const tx = new Transaction();
      
      tx.moveCall({
        target: `${BETTING_PACKAGE_ID}::betting::void_bet_admin`,
        arguments: [
          tx.object(ADMIN_CAP_ID),          // admin_cap: &AdminCap
          tx.object(BETTING_PLATFORM_ID),   // platform: &mut BettingPlatform
          tx.object(betObjectId),           // bet: &mut Bet
          tx.object('0x6'),                 // clock: &Clock
        ],
      });

      const result = await this.client.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx,
        options: {
          showEffects: true,
          showEvents: true,
        },
      });

      if (result.effects?.status?.status === 'success') {
        console.log(`✅ ON-CHAIN VOID: Bet ${betObjectId.slice(0, 12)}... refunded | TX: ${result.digest}`);
        return { success: true, txHash: result.digest };
      } else {
        const errorMsg = result.effects?.status?.error || 'Unknown error';
        console.error(`❌ ON-CHAIN VOID FAILED: ${errorMsg}`);
        return { success: false, error: errorMsg };
      }
    } catch (error: any) {
      console.error('❌ Void execution error:', error);
      return { success: false, error: error.message || 'Failed to execute on-chain void' };
    }
  }

  /**
   * Withdraw accrued fees from contract to admin wallet
   * @param amountSui - Amount of SUI to withdraw
   * @returns Transaction result
   */
  async withdrawFeesOnChain(
    amountSui: number,
    recipientAddress?: string
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    if (!amountSui || amountSui <= 0) {
      console.warn(`⚠️ FEE WITHDRAW SKIPPED: Zero or negative amount (${amountSui} SUI)`);
      return { success: false, error: 'Amount must be positive - skipping zero-value withdrawal' };
    }

    const { treasuryGuard } = await import('./treasuryGuardService');
    const guardCheck = treasuryGuard.check(amountSui, 'SUI', recipientAddress || 'admin', 'fee_withdraw');
    if (!guardCheck.allowed) {
      treasuryGuard.recordBlocked(amountSui, 'SUI', recipientAddress || 'admin', 'fee_withdraw', guardCheck.reason || 'guard');
      return { success: false, error: guardCheck.reason || 'Treasury guard blocked withdrawal' };
    }

    const keypair = this.getAdminKeypair();
    if (!keypair) {
      return { success: false, error: 'Admin private key not configured' };
    }

    try {
      // ── Withdraw from P2P contract fee vault (new contract, replaces old betting contract) ──
      const p2pPackageId  = (process.env.P2P_PACKAGE_ID   || '').trim();
      const p2pConfigId   = (process.env.P2P_CONFIG_ID    || '').trim();
      const p2pAdminCapId = (process.env.P2P_ADMIN_CAP_ID || '').trim();
      const SUI_CLOCK     = '0x0000000000000000000000000000000000000000000000000000000000000006';
      const SUI_TYPE      = '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';

      if (!p2pPackageId || !p2pConfigId || !p2pAdminCapId) {
        return { success: false, error: 'P2P contract not configured (P2P_PACKAGE_ID / P2P_CONFIG_ID / P2P_ADMIN_CAP_ID)' };
      }

      const amountMist = Math.floor(amountSui * 1e9);
      const adminAddr  = keypair.toSuiAddress();
      const tx = new Transaction();

      // p2p_betting::withdraw_fees<T>(cap, config, amount, recipient, clock)
      tx.moveCall({
        target:        `${p2pPackageId}::p2p_betting::withdraw_fees`,
        typeArguments: [SUI_TYPE],
        arguments: [
          tx.object(p2pAdminCapId),                       // _cap: &AdminCap
          tx.object(p2pConfigId),                         // config: &mut P2PConfig
          tx.pure.u64(amountMist),                        // amount: u64
          tx.pure.address(recipientAddress || adminAddr), // recipient: address
          tx.object(SUI_CLOCK),                           // clock: &Clock
        ],
      });

      const result = await this.client.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx,
        options: { showEffects: true },
      });

      if (result.effects?.status?.status === 'success') {
        console.log(`✅ P2P SUI FEES WITHDRAWN: ${amountSui} SUI → ${(recipientAddress || adminAddr).slice(0, 12)}... | TX: ${result.digest}`);
        treasuryGuard.record(amountSui, 'SUI', recipientAddress || adminAddr, 'fee_withdraw', result.digest);
        return { success: true, txHash: result.digest };
      } else {
        return { success: false, error: result.effects?.status?.error || 'P2P SUI fee withdrawal failed' };
      }
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Execute on-chain SBETS bet settlement via smart contract
   * Calls the settle_bet_sbets function for SBETS bets
   * @param betObjectId - The on-chain Bet object ID
   * @param won - Whether the bet won or lost
   * @returns Transaction result with hash or error
   */
  async executeSettleBetSbetsOnChain(
    betObjectId: string,
    won: boolean
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    const keypair = this.getAdminKeypair();
    if (!keypair) {
      const error = 'Admin private key not configured - cannot execute on-chain SBETS settlement';
      console.error(`❌ SBETS SETTLEMENT BLOCKED: ${error}`);
      return { success: false, error };
    }

    if (!ADMIN_CAP_ID) {
      const error = 'ADMIN_CAP_ID not configured - cannot execute on-chain SBETS settlement';
      console.error(`❌ SBETS SETTLEMENT BLOCKED: ${error}`);
      return { success: false, error };
    }

    try {
      const betObj = await this.client.getObject({ id: betObjectId, options: { showOwner: true } });
      const owner = betObj.data?.owner;
      if (owner && typeof owner === 'object' && 'AddressOwner' in owner) {
        return { success: false, error: `Bet object is owned by ${(owner as any).AddressOwner.slice(0,12)}... - cannot settle owned objects` };
      }

      const adminBalance = await this.getWalletBalance(keypair.toSuiAddress());
      if (adminBalance.sui < 0.01) {
        return { success: false, error: `Admin wallet too low for gas: ${adminBalance.sui.toFixed(4)} SUI` };
      }

      const tx = new Transaction();
      
      tx.moveCall({
        target: `${BETTING_PACKAGE_ID}::betting::settle_bet_sbets_admin`,
        arguments: [
          tx.object(ADMIN_CAP_ID),
          tx.object(BETTING_PLATFORM_ID),
          tx.object(betObjectId),
          tx.pure.bool(won),
          tx.object('0x6'),
        ],
      });

      const result = await this.client.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx,
        options: {
          showEffects: true,
          showEvents: true,
        },
      });

      if (result.effects?.status?.status === 'success') {
        const outcome = won ? 'WON (SBETS payout sent)' : 'LOST (SBETS stake kept in treasury)';
        console.log(`✅ ON-CHAIN SBETS SETTLEMENT: Bet ${betObjectId.slice(0, 12)}... ${outcome} | TX: ${result.digest}`);
        return { success: true, txHash: result.digest };
      } else {
        const errorMsg = result.effects?.status?.error || 'Unknown error';
        console.error(`❌ ON-CHAIN SBETS SETTLEMENT FAILED: ${errorMsg}`);
        return { success: false, error: errorMsg };
      }
    } catch (error: any) {
      console.error('❌ SBETS Settlement execution error:', error);
      return { success: false, error: error.message || 'Failed to execute on-chain SBETS settlement' };
    }
  }

  /**
   * Execute on-chain SBETS bet void via smart contract
   * @param betObjectId - The on-chain Bet object ID
   * @returns Transaction result with hash or error
   */
  async executeVoidBetSbetsOnChain(
    betObjectId: string
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    const keypair = this.getAdminKeypair();
    if (!keypair) {
      return { success: false, error: 'Admin private key not configured' };
    }

    if (!ADMIN_CAP_ID) {
      return { success: false, error: 'ADMIN_CAP_ID not configured' };
    }

    try {
      const tx = new Transaction();
      
      tx.moveCall({
        target: `${BETTING_PACKAGE_ID}::betting::void_bet_sbets_admin`,
        arguments: [
          tx.object(ADMIN_CAP_ID),          // admin_cap: &AdminCap
          tx.object(BETTING_PLATFORM_ID),
          tx.object(betObjectId),
          tx.object('0x6'),
        ],
      });

      const result = await this.client.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx,
        options: { showEffects: true },
      });

      if (result.effects?.status?.status === 'success') {
        console.log(`✅ ON-CHAIN SBETS VOID: Bet ${betObjectId.slice(0, 12)}... refunded | TX: ${result.digest}`);
        return { success: true, txHash: result.digest };
      } else {
        return { success: false, error: result.effects?.status?.error || 'Failed' };
      }
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async executeSettleBetUsdsuiOnChain(
    betObjectId: string,
    won: boolean
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    const keypair = this.getAdminKeypair();
    if (!keypair) {
      return { success: false, error: 'Admin private key not configured - cannot execute on-chain USDsui settlement' };
    }
    if (!ADMIN_CAP_ID) {
      return { success: false, error: 'ADMIN_CAP_ID not configured - cannot execute on-chain USDsui settlement' };
    }
    try {
      const betObj = await this.client.getObject({ id: betObjectId, options: { showOwner: true } });
      const owner = betObj.data?.owner;
      if (owner && typeof owner === 'object' && 'AddressOwner' in owner) {
        return { success: false, error: `Bet object is owned by ${(owner as any).AddressOwner.slice(0,12)}... - cannot settle owned objects` };
      }
      const tx = new Transaction();
      tx.moveCall({
        target: `${BETTING_PACKAGE_ID}::betting::settle_bet_usdsui_admin`,
        arguments: [
          tx.object(ADMIN_CAP_ID),
          tx.object(BETTING_PLATFORM_ID),
          tx.object(betObjectId),
          tx.pure.bool(won),
          tx.object('0x6'),
        ],
      });
      const result = await this.client.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx,
        options: { showEffects: true, showEvents: true },
      });
      if (result.effects?.status?.status === 'success') {
        const outcome = won ? 'WON (USDsui payout sent)' : 'LOST (USDsui stake kept in treasury)';
        console.log(`✅ ON-CHAIN USDSUI SETTLEMENT: Bet ${betObjectId.slice(0, 12)}... ${outcome} | TX: ${result.digest}`);
        return { success: true, txHash: result.digest };
      } else {
        const errorMsg = result.effects?.status?.error || 'Unknown error';
        console.error(`❌ ON-CHAIN USDSUI SETTLEMENT FAILED: ${errorMsg}`);
        return { success: false, error: errorMsg };
      }
    } catch (error: any) {
      console.error('❌ USDsui settlement execution error:', error);
      return { success: false, error: error.message || 'Failed to execute on-chain USDsui settlement' };
    }
  }

  async executeVoidBetUsdsuiOnChain(
    betObjectId: string
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    const keypair = this.getAdminKeypair();
    if (!keypair) {
      return { success: false, error: 'Admin private key not configured' };
    }
    if (!ADMIN_CAP_ID) {
      return { success: false, error: 'ADMIN_CAP_ID not configured' };
    }
    try {
      const tx = new Transaction();
      tx.moveCall({
        target: `${BETTING_PACKAGE_ID}::betting::void_bet_usdsui_admin`,
        arguments: [
          tx.object(ADMIN_CAP_ID),
          tx.object(BETTING_PLATFORM_ID),
          tx.object(betObjectId),
          tx.object('0x6'),
        ],
      });
      const result = await this.client.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx,
        options: { showEffects: true },
      });
      if (result.effects?.status?.status === 'success') {
        console.log(`✅ ON-CHAIN USDSUI VOID: Bet ${betObjectId.slice(0, 12)}... refunded | TX: ${result.digest}`);
        return { success: true, txHash: result.digest };
      } else {
        return { success: false, error: result.effects?.status?.error || 'Failed' };
      }
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async executePhantomVoidSuiOnChain(
    betObjectId: string
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    const keypair = this.getAdminKeypair();
    if (!keypair) {
      return { success: false, error: 'Admin private key not configured' };
    }
    if (!ADMIN_CAP_ID) {
      return { success: false, error: 'ADMIN_CAP_ID not configured' };
    }
    try {
      const tx = new Transaction();
      tx.moveCall({
        target: `${BETTING_PACKAGE_ID}::betting::void_phantom_bet`,
        arguments: [
          tx.object(ADMIN_CAP_ID),
          tx.object(BETTING_PLATFORM_ID),
          tx.object(betObjectId),
          tx.object('0x6'),
        ],
      });
      const result = await this.client.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx,
        options: { showEffects: true },
      });
      if (result.effects?.status?.status === 'success') {
        console.log(`✅ PHANTOM VOID SUI: Bet ${betObjectId.slice(0, 12)}... | TX: ${result.digest}`);
        return { success: true, txHash: result.digest };
      } else {
        return { success: false, error: result.effects?.status?.error || 'Failed' };
      }
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async executePhantomVoidSbetsOnChain(
    betObjectId: string
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    const keypair = this.getAdminKeypair();
    if (!keypair) {
      return { success: false, error: 'Admin private key not configured' };
    }
    if (!ADMIN_CAP_ID) {
      return { success: false, error: 'ADMIN_CAP_ID not configured' };
    }
    try {
      const tx = new Transaction();
      tx.moveCall({
        target: `${BETTING_PACKAGE_ID}::betting::void_phantom_bet_sbets`,
        arguments: [
          tx.object(ADMIN_CAP_ID),
          tx.object(BETTING_PLATFORM_ID),
          tx.object(betObjectId),
          tx.object('0x6'),
        ],
      });
      const result = await this.client.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx,
        options: { showEffects: true },
      });
      if (result.effects?.status?.status === 'success') {
        console.log(`✅ PHANTOM VOID SBETS: Bet ${betObjectId.slice(0, 12)}... | TX: ${result.digest}`);
        return { success: true, txHash: result.digest };
      } else {
        return { success: false, error: result.effects?.status?.error || 'Failed' };
      }
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async executePhantomVoidUsdsuiOnChain(
    betObjectId: string
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    const keypair = this.getAdminKeypair();
    if (!keypair) {
      return { success: false, error: 'Admin private key not configured' };
    }
    if (!ADMIN_CAP_ID) {
      return { success: false, error: 'ADMIN_CAP_ID not configured' };
    }
    try {
      const tx = new Transaction();
      tx.moveCall({
        target: `${BETTING_PACKAGE_ID}::betting::void_phantom_bet_usdsui`,
        arguments: [
          tx.object(ADMIN_CAP_ID),
          tx.object(BETTING_PLATFORM_ID),
          tx.object(betObjectId),
          tx.object('0x6'),
        ],
      });
      const result = await this.client.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx,
        options: { showEffects: true },
      });
      if (result.effects?.status?.status === 'success') {
        console.log(`✅ PHANTOM VOID USDSUI: Bet ${betObjectId.slice(0, 12)}... | TX: ${result.digest}`);
        return { success: true, txHash: result.digest };
      } else {
        return { success: false, error: result.effects?.status?.error || 'Failed' };
      }
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Withdraw SBETS fees from contract to admin wallet
   * @param amount - Amount of SBETS to withdraw
   * @returns Transaction result
   */
  async withdrawFeesSbetsOnChain(
    amount: number,
    recipientAddress?: string
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    if (!amount || amount <= 0) {
      console.warn(`⚠️ SBETS FEE WITHDRAW SKIPPED: Zero or negative amount (${amount} SBETS)`);
      return { success: false, error: 'Amount must be positive - skipping zero-value withdrawal' };
    }

    const { treasuryGuard } = await import('./treasuryGuardService');
    const guardCheck = treasuryGuard.check(amount, 'SBETS', recipientAddress || 'admin', 'sbets_fee_withdraw');
    if (!guardCheck.allowed) {
      treasuryGuard.recordBlocked(amount, 'SBETS', recipientAddress || 'admin', 'sbets_fee_withdraw', guardCheck.reason || 'guard');
      return { success: false, error: guardCheck.reason || 'Treasury guard blocked withdrawal' };
    }

    const keypair = this.getAdminKeypair();
    if (!keypair) {
      return { success: false, error: 'Admin private key not configured' };
    }

    try {
      // ── Withdraw from P2P contract fee vault — SBETS coin type ──
      const p2pPackageId  = (process.env.P2P_PACKAGE_ID   || '').trim();
      const p2pConfigId   = (process.env.P2P_CONFIG_ID    || '').trim();
      const p2pAdminCapId = (process.env.P2P_ADMIN_CAP_ID || '').trim();
      const SUI_CLOCK     = '0x0000000000000000000000000000000000000000000000000000000000000006';

      if (!p2pPackageId || !p2pConfigId || !p2pAdminCapId) {
        return { success: false, error: 'P2P contract not configured (P2P_PACKAGE_ID / P2P_CONFIG_ID / P2P_ADMIN_CAP_ID)' };
      }

      const amountMist = Math.floor(amount * 1e9);
      const adminAddr  = keypair.toSuiAddress();
      const tx = new Transaction();

      // p2p_betting::withdraw_fees<T>(cap, config, amount, recipient, clock)
      tx.moveCall({
        target:        `${p2pPackageId}::p2p_betting::withdraw_fees`,
        typeArguments: [SBETS_COIN_TYPE],
        arguments: [
          tx.object(p2pAdminCapId),                       // _cap: &AdminCap
          tx.object(p2pConfigId),                         // config: &mut P2PConfig
          tx.pure.u64(amountMist),                        // amount: u64
          tx.pure.address(recipientAddress || adminAddr), // recipient: address
          tx.object(SUI_CLOCK),                           // clock: &Clock
        ],
      });

      const result = await this.client.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx,
        options: { showEffects: true },
      });

      if (result.effects?.status?.status === 'success') {
        console.log(`✅ P2P SBETS FEES WITHDRAWN: ${amount} SBETS → ${(recipientAddress || adminAddr).slice(0, 12)}... | TX: ${result.digest}`);
        treasuryGuard.record(amount, 'SBETS', recipientAddress || adminAddr, 'sbets_fee_withdraw', result.digest);
        return { success: true, txHash: result.digest };
      } else {
        return { success: false, error: result.effects?.status?.error || 'P2P SBETS fee withdrawal failed' };
      }
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async withdrawFeesUsdsuiOnChain(
    amount: number,
    recipientAddress?: string
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    if (!amount || amount <= 0) {
      return { success: false, error: 'Amount must be positive - skipping zero-value withdrawal' };
    }

    const { treasuryGuard } = await import('./treasuryGuardService');
    const guardCheck = treasuryGuard.check(amount, 'USDSUI', recipientAddress || 'admin', 'usdsui_fee_withdraw');
    if (!guardCheck.allowed) {
      treasuryGuard.recordBlocked(amount, 'USDSUI', recipientAddress || 'admin', 'usdsui_fee_withdraw', guardCheck.reason || 'guard');
      return { success: false, error: guardCheck.reason || 'Treasury guard blocked withdrawal' };
    }

    const keypair = this.getAdminKeypair();
    if (!keypair) {
      return { success: false, error: 'Admin private key not configured' };
    }

    try {
      const p2pPackageId  = (process.env.P2P_PACKAGE_ID   || '').trim();
      const p2pConfigId   = (process.env.P2P_CONFIG_ID    || '').trim();
      const p2pAdminCapId = (process.env.P2P_ADMIN_CAP_ID || '').trim();
      const SUI_CLOCK     = '0x0000000000000000000000000000000000000000000000000000000000000006';

      if (!p2pPackageId || !p2pConfigId || !p2pAdminCapId) {
        return { success: false, error: 'P2P contract not configured (P2P_PACKAGE_ID / P2P_CONFIG_ID / P2P_ADMIN_CAP_ID)' };
      }

      const amountUnits = Math.floor(amount * 1e6);
      const adminAddr   = keypair.toSuiAddress();
      const tx = new Transaction();

      tx.moveCall({
        target:        `${p2pPackageId}::p2p_betting::withdraw_fees`,
        typeArguments: [USDSUI_COIN_TYPE],
        arguments: [
          tx.object(p2pAdminCapId),
          tx.object(p2pConfigId),
          tx.pure.u64(amountUnits),
          tx.pure.address(recipientAddress || adminAddr),
          tx.object(SUI_CLOCK),
        ],
      });

      const result = await this.client.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx,
        options: { showEffects: true },
      });

      if (result.effects?.status?.status === 'success') {
        console.log(`✅ P2P USDSUI FEES WITHDRAWN: ${amount} USDsui → ${(recipientAddress || adminAddr).slice(0, 12)}... | TX: ${result.digest}`);
        treasuryGuard.record(amount, 'USDSUI', recipientAddress || adminAddr, 'usdsui_fee_withdraw', result.digest);
        return { success: true, txHash: result.digest };
      } else {
        return { success: false, error: result.effects?.status?.error || 'P2P USDsui fee withdrawal failed' };
      }
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async withdrawTreasurySuiOnChain(
    amount: number,
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    if (!amount || amount <= 0) {
      return { success: false, error: 'Amount must be positive' };
    }

    const { treasuryGuard } = await import('./treasuryGuardService');
    const guardCheck = treasuryGuard.check(amount, 'SUI', 'admin', 'treasury_withdraw');
    if (!guardCheck.allowed) {
      treasuryGuard.recordBlocked(amount, 'SUI', 'admin', 'treasury_withdraw', guardCheck.reason || 'guard');
      return { success: false, error: guardCheck.reason || 'Treasury guard blocked withdrawal' };
    }

    const keypair = this.getAdminKeypair();
    if (!keypair) {
      return { success: false, error: 'Admin private key not configured' };
    }

    if (!ADMIN_CAP_ID) {
      return { success: false, error: 'ADMIN_CAP_ID not configured' };
    }

    try {
      const amountMist = Math.floor(amount * 1e9);
      const tx = new Transaction();

      tx.moveCall({
        target: `${BETTING_PACKAGE_ID}::betting::withdraw_treasury`,
        arguments: [
          tx.object(ADMIN_CAP_ID),
          tx.object(BETTING_PLATFORM_ID),
          tx.pure.u64(amountMist),
          tx.object('0x6'),
        ],
      });

      const result = await this.client.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx,
        options: { showEffects: true },
      });

      if (result.effects?.status?.status === 'success') {
        console.log(`✅ TREASURY SUI WITHDRAWN: ${amount} SUI | TX: ${result.digest}`);
        return { success: true, txHash: result.digest };
      } else {
        return { success: false, error: result.effects?.status?.error || 'Failed' };
      }
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async withdrawTreasurySbetsOnChain(
    amount: number,
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    if (!amount || amount <= 0) {
      return { success: false, error: 'Amount must be positive' };
    }

    const { treasuryGuard } = await import('./treasuryGuardService');
    const guardCheck = treasuryGuard.check(amount, 'SBETS', 'admin', 'treasury_withdraw');
    if (!guardCheck.allowed) {
      treasuryGuard.recordBlocked(amount, 'SBETS', 'admin', 'treasury_withdraw', guardCheck.reason || 'guard');
      return { success: false, error: guardCheck.reason || 'Treasury guard blocked withdrawal' };
    }

    const keypair = this.getAdminKeypair();
    if (!keypair) {
      return { success: false, error: 'Admin private key not configured' };
    }

    if (!ADMIN_CAP_ID) {
      return { success: false, error: 'ADMIN_CAP_ID not configured' };
    }

    try {
      const amountMist = Math.floor(amount * 1e9);
      const tx = new Transaction();
      
      tx.moveCall({
        target: `${BETTING_PACKAGE_ID}::betting::withdraw_treasury_sbets`,
        arguments: [
          tx.object(ADMIN_CAP_ID),
          tx.object(BETTING_PLATFORM_ID),
          tx.pure.u64(amountMist),
          tx.object('0x6'),
        ],
      });

      const result = await this.client.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx,
        options: { showEffects: true },
      });

      if (result.effects?.status?.status === 'success') {
        console.log(`✅ TREASURY SBETS WITHDRAWN: ${amount} SBETS | TX: ${result.digest}`);
        return { success: true, txHash: result.digest };
      } else {
        return { success: false, error: result.effects?.status?.error || 'Failed' };
      }
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async lockDirectWithdrawals(): Promise<{ success: boolean; txHash?: string; error?: string }> {
    const keypair = this.getAdminKeypair();
    if (!keypair) return { success: false, error: 'Admin private key not configured' };
    if (!ADMIN_CAP_ID) return { success: false, error: 'ADMIN_CAP_ID not configured' };

    try {
      const tx = new Transaction();
      tx.moveCall({
        target: `${BETTING_PACKAGE_ID}::betting::lock_direct_withdrawals`,
        arguments: [
          tx.object(ADMIN_CAP_ID),
          tx.object(BETTING_PLATFORM_ID),
          tx.object('0x6'),
        ],
      });

      const result = await this.client.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx,
        options: { showEffects: true },
      });

      if (result.effects?.status?.status === 'success') {
        console.log(`🔒 DIRECT WITHDRAWALS LOCKED on-chain | TX: ${result.digest}`);
        return { success: true, txHash: result.digest };
      }
      return { success: false, error: result.effects?.status?.error || 'Failed' };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async unlockDirectWithdrawals(): Promise<{ success: boolean; txHash?: string; error?: string }> {
    const keypair = this.getAdminKeypair();
    if (!keypair) return { success: false, error: 'Admin private key not configured' };
    if (!ADMIN_CAP_ID) return { success: false, error: 'ADMIN_CAP_ID not configured' };

    try {
      const tx = new Transaction();
      tx.moveCall({
        target: `${BETTING_PACKAGE_ID}::betting::unlock_direct_withdrawals`,
        arguments: [
          tx.object(ADMIN_CAP_ID),
          tx.object(BETTING_PLATFORM_ID),
          tx.object('0x6'),
        ],
      });

      const result = await this.client.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx,
        options: { showEffects: true },
      });

      if (result.effects?.status?.status === 'success') {
        console.log(`🔓 DIRECT WITHDRAWALS UNLOCKED on-chain | TX: ${result.digest}`);
        return { success: true, txHash: result.digest };
      }
      return { success: false, error: result.effects?.status?.error || 'Failed' };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async createMultisigGuard(
    signers: string[],
    threshold: number
  ): Promise<{ success: boolean; txHash?: string; guardId?: string; error?: string }> {
    const keypair = this.getAdminKeypair();
    if (!keypair) return { success: false, error: 'Admin private key not configured' };
    if (!ADMIN_CAP_ID) return { success: false, error: 'ADMIN_CAP_ID not configured' };
    if (signers.length < 2) return { success: false, error: 'Need at least 2 signers' };
    if (threshold < 1 || threshold > signers.length) return { success: false, error: 'Invalid threshold' };

    try {
      const tx = new Transaction();
      tx.moveCall({
        target: `${BETTING_PACKAGE_ID}::betting::create_multisig_guard`,
        arguments: [
          tx.object(ADMIN_CAP_ID),
          tx.object(BETTING_PLATFORM_ID),
          tx.pure.vector('address', signers),
          tx.pure.u64(threshold),
          tx.object('0x6'),
        ],
      });

      const result = await this.client.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx,
        options: { showEffects: true, showObjectChanges: true },
      });

      if (result.effects?.status?.status === 'success') {
        const created = result.objectChanges?.find(
          (c: any) => c.type === 'created' && c.objectType?.includes('MultisigGuard')
        );
        const guardId = created ? (created as any).objectId : undefined;
        console.log(`🛡️ MULTISIG GUARD CREATED: ${guardId} (${threshold}-of-${signers.length}) | TX: ${result.digest}`);
        return { success: true, txHash: result.digest, guardId };
      }
      return { success: false, error: result.effects?.status?.error || 'Failed' };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async proposeWithdrawal(
    amount: number,
    coinType: 'SUI' | 'SBETS' | 'USDSUI',
    withdrawalType: 'fees' | 'treasury',
    recipient: string
  ): Promise<{ success: boolean; txHash?: string; proposalId?: string; error?: string }> {
    const keypair = this.getAdminKeypair();
    if (!keypair) return { success: false, error: 'Admin private key not configured' };
    if (!MULTISIG_GUARD_ID) return { success: false, error: 'MULTISIG_GUARD_ID not configured' };

    try {
      const coinDecimals = coinType === 'USDSUI' ? 1e6 : 1e9;
      const amountMist = Math.floor(amount * coinDecimals);
      const coinTypeVal = coinType === 'SUI' ? 0 : coinType === 'USDSUI' ? 2 : 1;
      const withdrawalTypeVal = withdrawalType === 'fees' ? 0 : 1;

      const tx = new Transaction();
      tx.moveCall({
        target: `${BETTING_PACKAGE_ID}::betting::propose_withdrawal`,
        arguments: [
          tx.object(MULTISIG_GUARD_ID),
          tx.pure.u64(amountMist),
          tx.pure.u8(coinTypeVal),
          tx.pure.u8(withdrawalTypeVal),
          tx.pure.address(recipient),
          tx.object('0x6'),
        ],
      });

      const result = await this.client.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx,
        options: { showEffects: true, showObjectChanges: true },
      });

      if (result.effects?.status?.status === 'success') {
        const created = result.objectChanges?.find(
          (c: any) => c.type === 'created' && c.objectType?.includes('WithdrawalProposal')
        );
        const proposalId = created ? (created as any).objectId : undefined;
        console.log(`📋 WITHDRAWAL PROPOSED: ${amount} ${coinType} (${withdrawalType}) → ${recipient.slice(0,12)}... | Proposal: ${proposalId} | TX: ${result.digest}`);
        return { success: true, txHash: result.digest, proposalId };
      }
      return { success: false, error: result.effects?.status?.error || 'Failed' };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async approveWithdrawal(
    proposalId: string
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    const keypair = this.getAdminKeypair();
    if (!keypair) return { success: false, error: 'Admin private key not configured' };
    if (!MULTISIG_GUARD_ID) return { success: false, error: 'MULTISIG_GUARD_ID not configured' };

    try {
      const tx = new Transaction();
      tx.moveCall({
        target: `${BETTING_PACKAGE_ID}::betting::approve_withdrawal`,
        arguments: [
          tx.object(MULTISIG_GUARD_ID),
          tx.object(proposalId),
          tx.object('0x6'),
        ],
      });

      const result = await this.client.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx,
        options: { showEffects: true },
      });

      if (result.effects?.status?.status === 'success') {
        console.log(`✅ WITHDRAWAL APPROVED: Proposal ${proposalId.slice(0,12)}... | TX: ${result.digest}`);
        return { success: true, txHash: result.digest };
      }
      return { success: false, error: result.effects?.status?.error || 'Failed' };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async executeMultisigWithdrawal(
    proposalId: string,
    coinType: 'SUI' | 'SBETS' | 'USDSUI',
    withdrawalType: 'fees' | 'treasury'
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    const keypair = this.getAdminKeypair();
    if (!keypair) return { success: false, error: 'Admin private key not configured' };
    if (!ADMIN_CAP_ID) return { success: false, error: 'ADMIN_CAP_ID not configured' };
    if (!MULTISIG_GUARD_ID) return { success: false, error: 'MULTISIG_GUARD_ID not configured' };

    const targetMap: Record<string, string> = {
      'SUI_fees': 'execute_withdrawal_fees_sui',
      'SBETS_fees': 'execute_withdrawal_fees_sbets',
      'USDSUI_fees': 'execute_withdrawal_fees_usdsui',
      'SUI_treasury': 'execute_withdrawal_treasury_sui',
      'SBETS_treasury': 'execute_withdrawal_treasury_sbets',
      'USDSUI_treasury': 'execute_withdrawal_treasury_usdsui',
    };

    const target = targetMap[`${coinType}_${withdrawalType}`];
    if (!target) return { success: false, error: 'Invalid coin/withdrawal type combination' };

    try {
      const tx = new Transaction();
      tx.moveCall({
        target: `${BETTING_PACKAGE_ID}::betting::${target}`,
        arguments: [
          tx.object(MULTISIG_GUARD_ID),
          tx.object(proposalId),
          tx.object(ADMIN_CAP_ID),
          tx.object(BETTING_PLATFORM_ID),
          tx.object('0x6'),
        ],
      });

      const result = await this.client.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx,
        options: { showEffects: true },
      });

      if (result.effects?.status?.status === 'success') {
        console.log(`💰 MULTISIG WITHDRAWAL EXECUTED: ${coinType} ${withdrawalType} | Proposal: ${proposalId.slice(0,12)}... | TX: ${result.digest}`);
        return { success: true, txHash: result.digest };
      }
      return { success: false, error: result.effects?.status?.error || 'Failed' };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async updateMultisigSigners(
    newSigners: string[],
    newThreshold: number
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    const keypair = this.getAdminKeypair();
    if (!keypair) return { success: false, error: 'Admin private key not configured' };
    if (!ADMIN_CAP_ID) return { success: false, error: 'ADMIN_CAP_ID not configured' };
    if (!MULTISIG_GUARD_ID) return { success: false, error: 'MULTISIG_GUARD_ID not configured' };

    try {
      const tx = new Transaction();
      tx.moveCall({
        target: `${BETTING_PACKAGE_ID}::betting::update_multisig_signers`,
        arguments: [
          tx.object(ADMIN_CAP_ID),
          tx.object(MULTISIG_GUARD_ID),
          tx.pure.vector('address', newSigners),
          tx.pure.u64(newThreshold),
        ],
      });

      const result = await this.client.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx,
        options: { showEffects: true },
      });

      if (result.effects?.status?.status === 'success') {
        console.log(`🔄 MULTISIG SIGNERS UPDATED: ${newThreshold}-of-${newSigners.length} | TX: ${result.digest}`);
        return { success: true, txHash: result.digest };
      }
      return { success: false, error: result.effects?.status?.error || 'Failed' };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  isMultisigConfigured(): boolean {
    return !!MULTISIG_GUARD_ID;
  }

  /**
   * Send SUI directly from admin wallet (funded from treasury) to user's wallet
   * Used for DB settlement payouts when on-chain settlement isn't possible
   * Admin wallet should be funded via treasury withdrawals
   * @param recipientAddress - User's wallet address
   * @param amount - Amount in SUI (not MIST)
   * @returns Transaction result
   */
  async sendSuiToUser(recipientAddress: string, amount: number): Promise<{ success: boolean; txHash?: string; error?: string }> {
    try {
      const { treasuryGuard } = await import('./treasuryGuardService');
      const guardCheck = treasuryGuard.check(amount, 'SUI', recipientAddress, 'payout');
      if (!guardCheck.allowed) {
        treasuryGuard.recordBlocked(amount, 'SUI', recipientAddress, 'payout', guardCheck.reason || 'guard');
        return { success: false, error: guardCheck.reason || 'Treasury guard blocked this transfer' };
      }
      if (guardCheck.delayed && guardCheck.delayMs) {
        await new Promise(resolve => setTimeout(resolve, guardCheck.delayMs));
        if (treasuryGuard.isFrozen()) {
          return { success: false, error: 'Treasury was frozen during delay period' };
        }
      }

      const keypair = this.getAdminKeypair();
      if (!keypair) {
        return { success: false, error: 'Admin keypair not configured' };
      }

      if (amount <= 0) {
        return { success: false, error: 'Amount must be positive' };
      }

      const adminBalance = await this.getWalletBalance(keypair.toSuiAddress());
      const minGas = 0.01;
      if (adminBalance.sui < amount + minGas) {
        return { success: false, error: `Insufficient admin balance: ${adminBalance.sui.toFixed(4)} SUI < ${amount} + ${minGas} gas` };
      }

      const amountInMist = BigInt(Math.floor(amount * 1e9));
      const tx = new Transaction();
      
      const [coin] = tx.splitCoins(tx.gas, [amountInMist]);
      tx.transferObjects([coin], recipientAddress);

      const result = await this.client.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx,
        options: { showEffects: true },
      });

      if (result.effects?.status?.status === 'success') {
        treasuryGuard.record(amount, 'SUI', recipientAddress, 'payout', result.digest);
        console.log(`💸 SUI PAYOUT (from treasury funds): ${amount} SUI -> ${recipientAddress.slice(0,10)}... | TX: ${result.digest}`);
        return { success: true, txHash: result.digest };
      } else {
        return { success: false, error: result.effects?.status?.error || 'Transaction failed' };
      }
    } catch (error: any) {
      console.error(`❌ Failed to send SUI payout:`, error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send SBETS directly from admin wallet (funded from treasury) to user's wallet
   * Used for DB settlement payouts when on-chain settlement isn't possible
   * Admin wallet should be funded via treasury withdrawals
   * @param recipientAddress - User's wallet address  
   * @param amount - Amount in SBETS (not smallest unit)
   * @returns Transaction result
   */
  async sendSbetsToUser(recipientAddress: string, amount: number): Promise<{ success: boolean; txHash?: string; error?: string }> {
    try {
      const { treasuryGuard } = await import('./treasuryGuardService');
      const guardCheck = treasuryGuard.check(amount, 'SBETS', recipientAddress, 'payout');
      if (!guardCheck.allowed) {
        treasuryGuard.recordBlocked(amount, 'SBETS', recipientAddress, 'payout', guardCheck.reason || 'guard');
        return { success: false, error: guardCheck.reason || 'Treasury guard blocked this transfer' };
      }
      if (guardCheck.delayed && guardCheck.delayMs) {
        await new Promise(resolve => setTimeout(resolve, guardCheck.delayMs));
        if (treasuryGuard.isFrozen()) {
          return { success: false, error: 'Treasury was frozen during delay period' };
        }
      }

      const keypair = this.getAdminKeypair();
      if (!keypair) {
        return { success: false, error: 'Admin keypair not configured' };
      }

      if (amount <= 0) {
        return { success: false, error: 'Amount must be positive' };
      }

      const adminBalance = await this.getWalletBalance(keypair.toSuiAddress());
      if (adminBalance.sui < 0.01) {
        return { success: false, error: `Insufficient gas for SBETS transfer: ${adminBalance.sui.toFixed(4)} SUI` };
      }

      const amountInSmallest = BigInt(Math.floor(amount * 1_000_000_000));
      const tx = new Transaction();

      // Use raw JSON-RPC to bypass GraphQL page-size limits and get ALL coin objects
      const allCoinData: any[] = [];
      let cursor: string | null = null;
      const rpc = (this.client as any).getRpcClient?.() ?? (this.client as any).rpc ?? this.client;
      do {
        const page = await rpc.getCoins({
          owner: keypair.toSuiAddress(),
          coinType: this.sbetsTokenType,
          limit: 100,
          cursor: cursor ?? undefined,
        });
        if (page.data && page.data.length > 0) allCoinData.push(...page.data);
        cursor = page.hasNextPage ? (page.nextCursor ?? null) : null;
      } while (cursor);

      if (allCoinData.length === 0) {
        return { success: false, error: 'No SBETS in admin wallet - needs treasury funding' };
      }

      const totalBalance = allCoinData.reduce((sum: bigint, c: any) => sum + BigInt(c.balance), BigInt(0));
      if (totalBalance < amountInSmallest) {
        return { success: false, error: `Insufficient SBETS in admin wallet: ${Number(totalBalance) / 1_000_000_000} < ${amount}` };
      }

      const coinIds = allCoinData.map((c: any) => c.coinObjectId);
      if (coinIds.length > 1) {
        tx.mergeCoins(coinIds[0], coinIds.slice(1));
      }

      const [paymentCoin] = tx.splitCoins(coinIds[0], [amountInSmallest]);
      tx.transferObjects([paymentCoin], recipientAddress);

      const result = await this.client.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx,
        options: { showEffects: true },
      });

      if (result.effects?.status?.status === 'success') {
        treasuryGuard.record(amount, 'SBETS', recipientAddress, 'payout', result.digest);
        console.log(`💸 SBETS PAYOUT (from treasury funds): ${amount} SBETS -> ${recipientAddress.slice(0,10)}... | TX: ${result.digest}`);
        return { success: true, txHash: result.digest };
      } else {
        return { success: false, error: result.effects?.status?.error || 'Transaction failed' };
      }
    } catch (error: any) {
      console.error(`❌ Failed to send SBETS payout:`, error.message);
      return { success: false, error: error.message };
    }
  }

  async sendUsdsuiToUser(recipientAddress: string, amount: number): Promise<{ success: boolean; txHash?: string; error?: string }> {
    try {
      const { treasuryGuard } = await import('./treasuryGuardService');
      const guardCheck = treasuryGuard.check(amount, 'USDSUI', recipientAddress, 'payout');
      if (!guardCheck.allowed) {
        treasuryGuard.recordBlocked(amount, 'USDSUI', recipientAddress, 'payout', guardCheck.reason || 'guard');
        return { success: false, error: guardCheck.reason || 'Treasury guard blocked this transfer' };
      }
      if (guardCheck.delayed && guardCheck.delayMs) {
        await new Promise(resolve => setTimeout(resolve, guardCheck.delayMs));
        if (treasuryGuard.isFrozen()) {
          return { success: false, error: 'Treasury was frozen during delay period' };
        }
      }

      const keypair = this.getAdminKeypair();
      if (!keypair) return { success: false, error: 'Admin keypair not configured' };
      if (amount <= 0) return { success: false, error: 'Amount must be positive' };

      const adminBalance = await this.getWalletBalance(keypair.toSuiAddress());
      if (adminBalance.sui < 0.01) {
        return { success: false, error: `Insufficient gas for USDSUI transfer: ${adminBalance.sui.toFixed(4)} SUI` };
      }

      // USDSUI uses 6 decimals
      const amountInSmallest = BigInt(Math.floor(amount * 1_000_000));
      const tx = new Transaction();

      const coins = await this.client.getCoins({
        owner: keypair.toSuiAddress(),
        coinType: USDSUI_COIN_TYPE,
      });

      if (!coins.data || coins.data.length === 0) {
        return { success: false, error: 'No USDSUI in admin wallet - needs treasury funding' };
      }

      const totalBalance = coins.data.reduce((sum, c) => sum + BigInt(c.balance), BigInt(0));
      if (totalBalance < amountInSmallest) {
        return { success: false, error: `Insufficient USDSUI in admin wallet: ${Number(totalBalance) / 1_000_000} < ${amount}` };
      }

      const coinIds = coins.data.map(c => c.coinObjectId);
      if (coinIds.length > 1) {
        tx.mergeCoins(coinIds[0], coinIds.slice(1));
      }

      const [paymentCoin] = tx.splitCoins(coinIds[0], [amountInSmallest]);
      tx.transferObjects([paymentCoin], recipientAddress);

      const result = await this.client.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx,
        options: { showEffects: true },
      });

      if (result.effects?.status?.status === 'success') {
        treasuryGuard.record(amount, 'USDSUI', recipientAddress, 'payout', result.digest);
        console.log(`💸 USDSUI PAYOUT: ${amount} USDSUI -> ${recipientAddress.slice(0,10)}... | TX: ${result.digest}`);
        return { success: true, txHash: result.digest };
      } else {
        return { success: false, error: result.effects?.status?.error || 'Transaction failed' };
      }
    } catch (error: any) {
      console.error(`❌ Failed to send USDSUI payout:`, error.message);
      return { success: false, error: error.message };
    }
  }

  async sendUsdcToUser(recipientAddress: string, amount: number): Promise<{ success: boolean; txHash?: string; error?: string }> {
    try {
      const { treasuryGuard } = await import('./treasuryGuardService');
      const guardCheck = treasuryGuard.check(amount, 'USDC', recipientAddress, 'payout');
      if (!guardCheck.allowed) {
        treasuryGuard.recordBlocked(amount, 'USDC', recipientAddress, 'payout', guardCheck.reason || 'guard');
        return { success: false, error: guardCheck.reason || 'Treasury guard blocked this transfer' };
      }
      if (guardCheck.delayed && guardCheck.delayMs) {
        await new Promise(resolve => setTimeout(resolve, guardCheck.delayMs));
        if (treasuryGuard.isFrozen()) {
          return { success: false, error: 'Treasury was frozen during delay period' };
        }
      }

      const keypair = this.getAdminKeypair();
      if (!keypair) return { success: false, error: 'Admin keypair not configured' };
      if (amount <= 0) return { success: false, error: 'Amount must be positive' };

      const adminBalance = await this.getWalletBalance(keypair.toSuiAddress());
      if (adminBalance.sui < 0.01) {
        return { success: false, error: `Insufficient gas for USDC transfer: ${adminBalance.sui.toFixed(4)} SUI` };
      }

      // USDC uses 6 decimals
      const amountInSmallest = BigInt(Math.floor(amount * 1_000_000));
      const tx = new Transaction();

      const coins = await this.client.getCoins({
        owner: keypair.toSuiAddress(),
        coinType: USDC_COIN_TYPE,
      });

      if (!coins.data || coins.data.length === 0) {
        return { success: false, error: 'No USDC in admin wallet - needs treasury funding' };
      }

      const totalBalance = coins.data.reduce((sum, c) => sum + BigInt(c.balance), BigInt(0));
      if (totalBalance < amountInSmallest) {
        return { success: false, error: `Insufficient USDC in admin wallet: ${Number(totalBalance) / 1_000_000} < ${amount}` };
      }

      const coinIds = coins.data.map(c => c.coinObjectId);
      if (coinIds.length > 1) {
        tx.mergeCoins(coinIds[0], coinIds.slice(1));
      }

      const [paymentCoin] = tx.splitCoins(coinIds[0], [amountInSmallest]);
      tx.transferObjects([paymentCoin], recipientAddress);

      const result = await this.client.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx,
        options: { showEffects: true },
      });

      if (result.effects?.status?.status === 'success') {
        treasuryGuard.record(amount, 'USDC', recipientAddress, 'payout', result.digest);
        console.log(`💸 USDC PAYOUT: ${amount} USDC -> ${recipientAddress.slice(0,10)}... | TX: ${result.digest}`);
        return { success: true, txHash: result.digest };
      } else {
        return { success: false, error: result.effects?.status?.error || 'Transaction failed' };
      }
    } catch (error: any) {
      console.error(`❌ Failed to send USDC payout:`, error.message);
      return { success: false, error: error.message };
    }
  }

  async sendLbtcToUser(recipientAddress: string, amount: number): Promise<{ success: boolean; txHash?: string; error?: string }> {
    try {
      const { treasuryGuard } = await import('./treasuryGuardService');
      const guardCheck = treasuryGuard.check(amount, 'LBTC', recipientAddress, 'payout');
      if (!guardCheck.allowed) {
        treasuryGuard.recordBlocked(amount, 'LBTC', recipientAddress, 'payout', guardCheck.reason || 'guard');
        return { success: false, error: guardCheck.reason || 'Treasury guard blocked this transfer' };
      }
      if (guardCheck.delayed && guardCheck.delayMs) {
        await new Promise(resolve => setTimeout(resolve, guardCheck.delayMs));
        if (treasuryGuard.isFrozen()) {
          return { success: false, error: 'Treasury was frozen during delay period' };
        }
      }

      const keypair = this.getAdminKeypair();
      if (!keypair) return { success: false, error: 'Admin keypair not configured' };
      if (amount <= 0) return { success: false, error: 'Amount must be positive' };

      const adminBalance = await this.getWalletBalance(keypair.toSuiAddress());
      if (adminBalance.sui < 0.01) {
        return { success: false, error: `Insufficient gas for LBTC transfer: ${adminBalance.sui.toFixed(4)} SUI` };
      }

      // LBTC uses 8 decimals (Bitcoin-standard: 1 LBTC = 100_000_000 satoshis)
      const amountInSmallest = BigInt(Math.floor(amount * 1e8));
      const tx = new Transaction();

      const coins = await this.client.getCoins({
        owner: keypair.toSuiAddress(),
        coinType: LBTC_COIN_TYPE,
      });

      if (!coins.data || coins.data.length === 0) {
        return { success: false, error: 'No LBTC in admin wallet - needs treasury funding' };
      }

      const totalBalance = coins.data.reduce((sum, c) => sum + BigInt(c.balance), BigInt(0));
      if (totalBalance < amountInSmallest) {
        return { success: false, error: `Insufficient LBTC in admin wallet: ${Number(totalBalance) / 1e8} < ${amount}` };
      }

      const coinIds = coins.data.map(c => c.coinObjectId);
      if (coinIds.length > 1) {
        tx.mergeCoins(coinIds[0], coinIds.slice(1));
      }

      const [paymentCoin] = tx.splitCoins(coinIds[0], [amountInSmallest]);
      tx.transferObjects([paymentCoin], recipientAddress);

      const result = await this.client.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx,
        options: { showEffects: true },
      });

      if (result.effects?.status?.status === 'success') {
        treasuryGuard.record(amount, 'LBTC', recipientAddress, 'payout', result.digest);
        console.log(`💸 LBTC PAYOUT: ${amount} LBTC -> ${recipientAddress.slice(0,10)}... | TX: ${result.digest}`);
        return { success: true, txHash: result.digest };
      } else {
        return { success: false, error: result.effects?.status?.error || 'Transaction failed' };
      }
    } catch (error: any) {
      console.error(`❌ Failed to send LBTC payout:`, error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Check on-chain bet status to avoid settling already-settled bets
   * Returns the bet status from the blockchain, or null if bet not found
   * @param betObjectId - The on-chain Bet object ID
   * @returns Bet status info or null
   */
  async getOnChainBetInfo(betObjectId: string): Promise<{
    settled: boolean;
    status: string;
    amount: number;
    potentialPayout: number;
    eventId?: string;
    marketId?: string;
    prediction?: string;
    odds?: number;
    bettor?: string;
    coinType?: string;
    placedAt?: number;
    settledAt?: number;
    platformFee?: number;
  } | null> {
    try {
      const betObj = await this.client.getObject({
        id: betObjectId,
        options: { showContent: true },
      });

      if (betObj.data?.content?.dataType === 'moveObject') {
        const fields = (betObj.data.content as any).fields;
        
        // Check the 'status' field in the bet object (0=pending, 1=won, 2=lost, 3=void)
        const statusCode = parseInt(fields.status || '0');
        const settled = statusCode !== 0; // Any non-pending status means settled
        const status = statusCode === 0 ? 'pending' : statusCode === 1 ? 'won' : statusCode === 2 ? 'lost' : 'void';
        const betCoinTypeCode = parseInt(fields.coin_type || '0');
        const betDecimals = betCoinTypeCode === 2 ? 1e6 : 1e9;
        const amount = parseInt(fields.amount || fields.stake || '0') / betDecimals;
        const potentialPayout = parseInt(fields.potential_payout || '0') / betDecimals;
        
        // Decode vector<u8> fields to strings
        const decodeVectorToString = (arr: number[] | undefined): string | undefined => {
          if (!arr || !Array.isArray(arr)) return undefined;
          try {
            return String.fromCharCode(...arr);
          } catch {
            return undefined;
          }
        };
        
        const eventId = decodeVectorToString(fields.event_id);
        const marketId = decodeVectorToString(fields.market_id);
        const prediction = decodeVectorToString(fields.prediction);
        const odds = fields.odds ? parseInt(fields.odds) / 100 : undefined; // Convert from basis points
        const bettor = fields.bettor;
        const coinTypeCode = parseInt(fields.coin_type || '0');
        const coinType = coinTypeCode === 0 ? 'SUI' : coinTypeCode === 2 ? 'USDSUI' : 'SBETS';
        const coinDecimals = coinType === 'USDSUI' ? 1e6 : 1e9;
        const placedAt = fields.placed_at ? parseInt(fields.placed_at) : undefined;
        const settledAt = fields.settled_at ? parseInt(fields.settled_at) : undefined;
        const platformFee = fields.platform_fee ? parseInt(fields.platform_fee) / coinDecimals : undefined;
        
        console.log(`[OnChainBet] ${betObjectId.slice(0, 12)}... status=${status} (code=${statusCode}), settled=${settled}, amount=${amount}, prediction=${prediction}`);
        
        return {
          settled,
          status,
          amount,
          potentialPayout,
          eventId,
          marketId,
          prediction,
          odds,
          bettor,
          coinType,
          placedAt,
          settledAt,
          platformFee
        };
      }
      
      console.warn(`[OnChainBet] ${betObjectId.slice(0, 12)}... not found or not a move object`);
      return null;
    } catch (error: any) {
      console.error(`[OnChainBet] Error fetching bet ${betObjectId}:`, error.message);
      return null;
    }
  }

  /**
   * Read accrued fees from the P2P contract fee_vault Bag.
   * The Bag stores Balance<T> entries keyed by TypeName (one per coin type).
   */
  async getP2PAccruedFees(): Promise<{ sui: number; sbets: number; usdsui: number; usdc: number; lbtc: number }> {
    const p2pConfigId = (process.env.P2P_CONFIG_ID || '').trim();
    if (!p2pConfigId) return { sui: 0, sbets: 0, usdsui: 0, usdc: 0, lbtc: 0 };

    try {
      const configObj = await this.client.getObject({
        id: p2pConfigId,
        options: { showContent: true },
      });

      if (configObj.data?.content?.dataType !== 'moveObject') return { sui: 0, sbets: 0, usdsui: 0, usdc: 0, lbtc: 0 };
      const fields = (configObj.data.content as any).fields;

      // fee_vault is a Bag — its entries are stored as dynamic fields on the Bag object ID
      const feeVaultId = fields.fee_vault?.fields?.id?.id;
      if (!feeVaultId) {
        console.warn('[getP2PAccruedFees] fee_vault bag ID not found in P2PConfig fields');
        return { sui: 0, sbets: 0, usdsui: 0, usdc: 0, lbtc: 0 };
      }

      const dynFields = await this.client.getDynamicFields({ parentId: feeVaultId });
      let suiFees = 0, sbetsFees = 0, usdsuiFees = 0, usdcFees = 0, lbtcFees = 0;

      for (const field of dynFields.data) {
        try {
          // Each dynamic field entry has an objectId — fetch it to read the Balance value.
          // Sui wraps Bag values as: Field<TypeName, Balance<T>> with content.fields = { name, value: { fields: { value: "amount" } } }
          const fieldObj = await this.client.getObject({
            id: field.objectId,
            options: { showContent: true },
          });
          const contentFields = (fieldObj.data?.content as any)?.fields ?? {};
          // balance value can be nested as { value: { fields: { value: "N" } } } or flat { value: "N" }
          const rawValue =
            contentFields?.value?.fields?.value ??
            contentFields?.value ??
            '0';
          const amount   = parseInt(String(rawValue));
          // type name is in the field's name (TypeName struct with .name: string)
          const typeName = String(
            (field.name as any)?.value?.name ?? (contentFields?.name?.fields?.name ?? ''),
          ).toLowerCase();

          if (typeName.includes('::sui::sui')) {
            suiFees    = amount / 1e9;
          } else if (typeName.includes('::sbets::sbets')) {
            sbetsFees  = amount / 1e9;
          } else if (typeName.includes('::usdsui::usdsui')) {
            usdsuiFees = amount / 1e6;
          } else if (typeName.includes('::usdc::usdc')) {
            usdcFees   = amount / 1e6;  // Circle USDC — 6 decimals
          } else if (typeName.includes('::lbtc::lbtc')) {
            lbtcFees   = amount / 1e8;  // Lombard LBTC — 8 decimals (Bitcoin standard)
          }
        } catch { /* skip unreadable entries */ }
      }

      console.log(`[getP2PAccruedFees] Vault → SUI: ${suiFees.toFixed(6)}, SBETS: ${sbetsFees.toFixed(2)}, USDsui: ${usdsuiFees.toFixed(4)}, USDC: ${usdcFees.toFixed(4)}, LBTC: ${lbtcFees.toFixed(8)}`);
      return { sui: suiFees, sbets: sbetsFees, usdsui: usdsuiFees, usdc: usdcFees, lbtc: lbtcFees };
    } catch (err: any) {
      console.error('[getP2PAccruedFees] Error reading P2P fee vault:', err.message);
      return { sui: 0, sbets: 0, usdsui: 0, usdc: 0, lbtc: 0 };
    }
  }

  /**
   * Withdraw USDC fees from the P2P contract fee_vault to admin wallet (or specified recipient).
   */
  async withdrawFeesUsdcOnChain(
    amount: number,
    recipientAddress?: string
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    if (!amount || amount <= 0) {
      return { success: false, error: 'Amount must be positive - skipping zero-value withdrawal' };
    }

    const { treasuryGuard } = await import('./treasuryGuardService');
    const guardCheck = treasuryGuard.check(amount, 'USDC', recipientAddress || 'admin', 'usdc_fee_withdraw');
    if (!guardCheck.allowed) {
      treasuryGuard.recordBlocked(amount, 'USDC', recipientAddress || 'admin', 'usdc_fee_withdraw', guardCheck.reason || 'guard');
      return { success: false, error: guardCheck.reason || 'Treasury guard blocked withdrawal' };
    }

    const keypair = this.getAdminKeypair();
    if (!keypair) {
      return { success: false, error: 'Admin private key not configured' };
    }

    try {
      const p2pPackageId  = (process.env.P2P_PACKAGE_ID   || '').trim();
      const p2pConfigId   = (process.env.P2P_CONFIG_ID    || '').trim();
      const p2pAdminCapId = (process.env.P2P_ADMIN_CAP_ID || '').trim();
      const SUI_CLOCK     = '0x0000000000000000000000000000000000000000000000000000000000000006';

      if (!p2pPackageId || !p2pConfigId || !p2pAdminCapId) {
        return { success: false, error: 'P2P contract not configured (P2P_PACKAGE_ID / P2P_CONFIG_ID / P2P_ADMIN_CAP_ID)' };
      }

      const amountUnits = Math.floor(amount * 1e6); // USDC — 6 decimals
      const adminAddr   = keypair.toSuiAddress();
      const tx = new Transaction();

      tx.moveCall({
        target:        `${p2pPackageId}::p2p_betting::withdraw_fees`,
        typeArguments: [USDC_COIN_TYPE],
        arguments: [
          tx.object(p2pAdminCapId),
          tx.object(p2pConfigId),
          tx.pure.u64(amountUnits),
          tx.pure.address(recipientAddress || adminAddr),
          tx.object(SUI_CLOCK),
        ],
      });

      const result = await this.client.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx,
        options: { showEffects: true },
      });

      if (result.effects?.status?.status === 'success') {
        console.log(`✅ P2P USDC FEES WITHDRAWN: ${amount} USDC → ${(recipientAddress || adminAddr).slice(0, 12)}... | TX: ${result.digest}`);
        treasuryGuard.record(amount, 'USDC', recipientAddress || adminAddr, 'usdc_fee_withdraw', result.digest);
        return { success: true, txHash: result.digest };
      } else {
        return { success: false, error: result.effects?.status?.error || 'P2P USDC fee withdrawal failed' };
      }
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Withdraw LBTC fees from the P2P contract fee_vault to admin wallet (or specified recipient).
   */
  async withdrawFeesLbtcOnChain(
    amount: number,
    recipientAddress?: string
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    if (!amount || amount <= 0) {
      return { success: false, error: 'Amount must be positive - skipping zero-value withdrawal' };
    }

    const { treasuryGuard } = await import('./treasuryGuardService');
    const guardCheck = treasuryGuard.check(amount, 'LBTC', recipientAddress || 'admin', 'lbtc_fee_withdraw');
    if (!guardCheck.allowed) {
      treasuryGuard.recordBlocked(amount, 'LBTC', recipientAddress || 'admin', 'lbtc_fee_withdraw', guardCheck.reason || 'guard');
      return { success: false, error: guardCheck.reason || 'Treasury guard blocked withdrawal' };
    }

    const keypair = this.getAdminKeypair();
    if (!keypair) {
      return { success: false, error: 'Admin private key not configured' };
    }

    try {
      const p2pPackageId  = (process.env.P2P_PACKAGE_ID   || '').trim();
      const p2pConfigId   = (process.env.P2P_CONFIG_ID    || '').trim();
      const p2pAdminCapId = (process.env.P2P_ADMIN_CAP_ID || '').trim();
      const SUI_CLOCK     = '0x0000000000000000000000000000000000000000000000000000000000000006';

      if (!p2pPackageId || !p2pConfigId || !p2pAdminCapId) {
        return { success: false, error: 'P2P contract not configured (P2P_PACKAGE_ID / P2P_CONFIG_ID / P2P_ADMIN_CAP_ID)' };
      }

      const amountUnits = Math.floor(amount * 1e8); // LBTC — 8 decimals (Bitcoin standard)
      const adminAddr   = keypair.toSuiAddress();
      const tx = new Transaction();

      tx.moveCall({
        target:        `${p2pPackageId}::p2p_betting::withdraw_fees`,
        typeArguments: [LBTC_COIN_TYPE],
        arguments: [
          tx.object(p2pAdminCapId),
          tx.object(p2pConfigId),
          tx.pure.u64(amountUnits),
          tx.pure.address(recipientAddress || adminAddr),
          tx.object(SUI_CLOCK),
        ],
      });

      const result = await this.client.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx,
        options: { showEffects: true },
      });

      if (result.effects?.status?.status === 'success') {
        console.log(`✅ P2P LBTC FEES WITHDRAWN: ${amount} LBTC → ${(recipientAddress || adminAddr).slice(0, 12)}... | TX: ${result.digest}`);
        treasuryGuard.record(amount, 'LBTC', recipientAddress || adminAddr, 'lbtc_fee_withdraw', result.digest);
        return { success: true, txHash: result.digest };
      } else {
        return { success: false, error: result.effects?.status?.error || 'P2P LBTC fee withdrawal failed' };
      }
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Get platform contract info (treasury balance, stats) - dual treasury
   */
  async getPlatformInfo(): Promise<{
    treasuryBalanceSui: number;
    treasuryBalanceSbets: number;
    treasuryBalanceUsdsui: number;
    totalBets: number;
    totalVolumeSui: number;
    totalVolumeSbets: number;
    totalLiabilitySui: number;
    totalLiabilitySbets: number;
    accruedFeesSui: number;
    accruedFeesSbets: number;
    paused: boolean;
    platformFeeBps: number;
    minBetSui: number;
    maxBetSui: number;
    minBetSbets: number;
    maxBetSbets: number;
  } | null> {
    try {
      const platformObj = await this.client.getObject({
        id: BETTING_PLATFORM_ID,
        options: { showContent: true },
      });

      if (platformObj.data?.content?.dataType === 'moveObject') {
        const fields = (platformObj.data.content as any).fields;
        
        console.log('[BlockchainBetService] Platform fields treasury_sui:', fields.treasury_sui);
        console.log('[BlockchainBetService] Platform fields treasury_sbets:', fields.treasury_sbets);
        console.log('[BlockchainBetService] Platform fields treasury_usdsui:', fields.treasury_usdsui);
        
        const getTreasuryValue = (field: any, decimals: number = 1e9): number => {
          if (!field) return 0;
          if (typeof field === 'string' || typeof field === 'number') {
            return parseInt(String(field)) / decimals;
          }
          if (field?.fields?.value) {
            return parseInt(field.fields.value) / decimals;
          }
          return 0;
        };
        
        let usdsuiTreasury = getTreasuryValue(fields.treasury_usdsui, 1e6);
        if (usdsuiTreasury === 0) {
          try {
            const adminWallet = process.env.ADMIN_WALLET_ADDRESS || ADMIN_WALLET;
            if (adminWallet) {
              const usdsuiBalance = await this.client.getBalance({
                owner: adminWallet,
                coinType: USDSUI_COIN_TYPE,
              });
              usdsuiTreasury = Number(usdsuiBalance.totalBalance) / 1e6;
            }
          } catch (e) {
            console.warn('[getPlatformInfo] Failed to fetch admin wallet USDsui balance:', (e as Error).message);
          }
        }

        const info = {
          treasuryBalanceSui: getTreasuryValue(fields.treasury_sui),
          treasuryBalanceSbets: getTreasuryValue(fields.treasury_sbets),
          treasuryBalanceUsdsui: usdsuiTreasury,
          totalBets: parseInt(fields.total_bets || '0'),
          totalVolumeSui: parseInt(fields.total_volume_sui || '0') / 1e9,
          totalVolumeSbets: parseInt(fields.total_volume_sbets || '0') / 1e9,
          totalVolumeUsdsui: parseInt(fields.total_volume_usdsui || '0') / 1e6,
          totalLiabilitySui: parseInt(fields.total_potential_liability_sui || '0') / 1e9,
          totalLiabilitySbets: parseInt(fields.total_potential_liability_sbets || '0') / 1e9,
          totalLiabilityUsdsui: parseInt(fields.total_potential_liability_usdsui || '0') / 1e6,
          accruedFeesSui: 0,
          accruedFeesSbets: 0,
          accruedFeesUsdsui: 0,
          paused: fields.paused || false,
          platformFeeBps: parseInt(fields.platform_fee_bps || '0'),
          minBetSui: parseInt(fields.min_bet_sui || fields.min_bet || '0') / 1e9,
          maxBetSui: parseInt(fields.max_bet_sui || fields.max_bet || '0') / 1e9,
          minBetSbets: parseInt(fields.min_bet_sbets || fields.min_bet || '0') / 1e9,
          maxBetSbets: parseInt(fields.max_bet_sbets || fields.max_bet || '0') / 1e9,
          minBetUsdsui: parseInt(fields.min_bet_usdsui || '0') / 1e6,
          maxBetUsdsui: parseInt(fields.max_bet_usdsui || '0') / 1e6,
        };

        // ── Always read fees from the live P2P contract fee_vault ──
        try {
          const p2pFees = await this.getP2PAccruedFees();
          info.accruedFeesSui    = p2pFees.sui;
          info.accruedFeesSbets  = p2pFees.sbets;
          info.accruedFeesUsdsui = p2pFees.usdsui;
        } catch (feeErr: any) {
          console.warn('[getPlatformInfo] P2P fee vault read failed, fees default to 0:', feeErr.message);
        }

        return info;
      }
      return null;
    } catch (error) {
      console.error('Failed to get platform info:', error);
      return null;
    }
  }

  /**
   * Sync on-chain bets to database - finds bets placed directly on contract that aren't tracked
   */
  async syncOnChainBetsToDatabase(): Promise<{ synced: number; errors: string[] }> {
    const errors: string[] = [];
    let synced = 0;

    try {
      console.log('🔄 Starting on-chain bet sync...');

      // Query all BetPlaced events from the smart contract
      const eventsResponse = await this.client.queryEvents({
        query: {
          MoveEventType: `${BETTING_PACKAGE_ID}::betting::BetPlaced`
        },
        limit: 100,
        order: 'descending'
      });

      console.log(`📊 Found ${eventsResponse.data.length} BetPlaced events on-chain`);

      let skippedVoided = 0;
      let skippedRejected = 0;

      for (const event of eventsResponse.data) {
        try {
          const parsed = event.parsedJson as any;
          const betObjectId = parsed.bet_id;

          if (rejectedOnChainBets.has(betObjectId)) {
            skippedRejected++;
            continue;
          }

          try {
            const betObjCheck = await this.client.getObject({ id: betObjectId, options: { showContent: true } });
            if (betObjCheck.data?.content && betObjCheck.data.content.dataType === 'moveObject') {
              const betFields = (betObjCheck.data.content as any).fields;
              const betStatus = parseInt(betFields.status || '0');
              if (betStatus !== 0) {
                rejectedOnChainBets.add(betObjectId);
                skippedVoided++;
                continue;
              }
            } else if (!betObjCheck.data) {
              rejectedOnChainBets.add(betObjectId);
              skippedVoided++;
              continue;
            }
          } catch (objErr) {
            rejectedOnChainBets.add(betObjectId);
            skippedVoided++;
            continue;
          }

          const bettor = parsed.bettor;
          const rawCoinType = parseInt(parsed.coin_type || '0');
          const coinType = rawCoinType === 0 ? 'SUI' : rawCoinType === 2 ? 'USDSUI' : 'SBETS';
          const decimals = coinType === 'USDSUI' ? 1e6 : 1e9;
          const stake = parseInt(parsed.stake) / decimals;
          const odds = parseInt(parsed.odds) / 100;
          const potentialPayout = parseInt(parsed.potential_payout) / decimals;
          const timestamp = parseInt(parsed.timestamp);
          
          const decodeBytes = (arr: number[] | undefined): string => {
            if (!arr || !Array.isArray(arr)) return 'Unknown';
            try {
              return Buffer.from(arr).toString('utf8');
            } catch (e) {
              return 'Error decoding';
            }
          };

          const prediction = decodeBytes(parsed.prediction);
          const market = decodeBytes(parsed.market);
          
          let eventName = "Unknown Event";
          let homeTeam = "Unknown";
          let awayTeam = "Unknown";
          
          // Improved extraction logic for synchronized bets
          if (prediction && prediction.includes(" vs ")) {
            const parts = prediction.split(":");
            eventName = parts[0].trim();
            const teams = eventName.split(" vs ");
            homeTeam = teams[0]?.trim() || "Unknown";
            awayTeam = teams[1]?.trim() || "Unknown";
          } else if (market && market.includes(" vs ")) {
            eventName = market.split(":")[0].trim();
            const teams = eventName.split(" vs ");
            homeTeam = teams[0]?.trim() || "Unknown";
            awayTeam = teams[1]?.trim() || "Unknown";
          }
          
          // Decode event_id from byte arrays
          const eventId = decodeBytes(parsed.event_id as number[]);

          // Check if this bet already exists in database by bet_object_id
          const { storage } = await import('../storage');
          const existingBets = await storage.getBetsByBetObjectId(betObjectId);
          
          if (existingBets && existingBets.length > 0) {
            continue; // Already tracked
          }

          // ANTI-EXPLOIT: Blocked wallet check
          const BLOCKED_WALLETS = new Set<string>([
            '0x6bac2359a253417007d74adb9a46d803b8883f81ceb3edada3a50790c3a1837b',
            '0x7b05bc6f68ba7a65d7ca329c6108d6643b30913697ba31f4ab2a494d23149125',
            '0xf7825ecdfb898be6f3b9fe35e3d2dbc0f053d988f10074be7e905e87a0d2132e',
            '0xa7f1a938f7cdb06986e139c6fd2cfc0c7e933ba34f0bc2a56b127fcb77677199',
            '0xd8c7f4c9dba0da5ef5e869a32aa5a4f9c812d30f059c454e2c5e49bfce3f3574',
            '0x09ee92c61fc50d5af645f3757447b31ab37cd31847103975e5559b6ca0052446',
            '0xcae5696ab09449c54c15b95ac08f41a0a4cd449d1c491ca6b769cecba1715cbf',
          ]);
          if (BLOCKED_WALLETS.has(bettor?.toLowerCase())) {
            rejectedOnChainBets.add(betObjectId);
            console.warn(`🚫 EXPLOIT BLOCKED: Rejecting bet ${betObjectId.slice(0, 12)}... from blocked wallet ${bettor.slice(0, 12)}...`);
            continue;
          }

          if (eventName === "Unknown Event" || homeTeam === "Unknown" || awayTeam === "Unknown") {
            try {
              const apiSvc = (await import('./apiSportsService')).default;
              const { freeSportsService: fsSvc } = await import('./freeSportsService');
              const lookup = apiSvc.lookupEventSync(eventId);
              if (lookup.found && lookup.homeTeam && lookup.awayTeam) {
                eventName = `${lookup.homeTeam} vs ${lookup.awayTeam}`;
                homeTeam = lookup.homeTeam;
                awayTeam = lookup.awayTeam;
                console.log(`✅ On-chain sync: Recovered event data for ${betObjectId.slice(0, 12)}... via cache: ${eventName}`);
              } else {
                const fsLookup = fsSvc.lookupEvent(eventId);
                if (fsLookup.found && fsLookup.event?.homeTeam && fsLookup.event?.awayTeam) {
                  eventName = `${fsLookup.event.homeTeam} vs ${fsLookup.event.awayTeam}`;
                  homeTeam = fsLookup.event.homeTeam;
                  awayTeam = fsLookup.event.awayTeam;
                  console.log(`✅ On-chain sync: Recovered event data for ${betObjectId.slice(0, 12)}... via sports cache: ${eventName}`);
                }
              }
            } catch (lookupErr) {}

            if (eventName === "Unknown Event" || homeTeam === "Unknown" || awayTeam === "Unknown") {
              try {
                const { db: lookupDb } = await import('../db');
                const { sql: lookupSql } = await import('drizzle-orm');
                const { bets: betsLookup } = await import('@shared/schema');
                const dbMatch = await lookupDb.select({
                  eventName: betsLookup.eventName,
                  homeTeam: betsLookup.homeTeam,
                  awayTeam: betsLookup.awayTeam
                }).from(betsLookup)
                  .where(lookupSql`${betsLookup.externalEventId} = ${eventId}`)
                  .limit(1);
                if (dbMatch.length > 0 && dbMatch[0].eventName && dbMatch[0].homeTeam && dbMatch[0].awayTeam) {
                  eventName = dbMatch[0].eventName;
                  homeTeam = dbMatch[0].homeTeam;
                  awayTeam = dbMatch[0].awayTeam;
                  console.log(`✅ On-chain sync: Recovered event data for ${betObjectId.slice(0, 12)}... via DB: ${eventName}`);
                }
              } catch (dbLookupErr) {}
            }

            if (eventName === "Unknown Event" || homeTeam === "Unknown" || awayTeam === "Unknown") {
              rejectedOnChainBets.add(betObjectId);
              console.warn(`🚫 EXPLOIT BLOCKED: Rejecting bet ${betObjectId.slice(0, 12)}... - Unknown Event (likely fake/exploitative bet)`);
              continue;
            }
          }
          
          // ANTI-EXPLOIT: Validate event ID is a real event in our system
          try {
            const apiSportsService = (await import('./apiSportsService')).default;
            const { freeSportsService } = await import('./freeSportsService');
            
            // Check paid API sports first
            const eventData = apiSportsService.lookupEventSync(eventId);
            if (eventData && eventData.found && (eventData.homeTeam || eventData.awayTeam)) {
              homeTeam = eventData.homeTeam || homeTeam;
              awayTeam = eventData.awayTeam || awayTeam;
              eventName = `${homeTeam} vs ${awayTeam}`;
            } else {
              // Check free sports events (basketball_, mma_, baseball_, etc.)
              const freeLookup = freeSportsService.lookupEvent(eventId);
              if (freeLookup.found && freeLookup.event) {
                homeTeam = freeLookup.event.homeTeam || homeTeam;
                awayTeam = freeLookup.event.awayTeam || awayTeam;
                eventName = `${homeTeam} vs ${awayTeam}`;
                console.log(`✅ Free sport event verified: ${eventId} (${eventName})`);
              } else if (eventId.startsWith('parlay_')) {
                const legEventIds = this.extractParlayLegIds(eventId);
                let allLegsValid = true;
                for (const fullLegId of legEventIds) {
                  const legCheck = apiSportsService.lookupEventSync(fullLegId);
                  const freeLegCheck = freeSportsService.lookupEvent(fullLegId);
                  if (!legCheck.found && !freeLegCheck.found) {
                    const numericOnly = fullLegId.replace(/^[a-z-]+_/, '');
                    if (numericOnly !== fullLegId) {
                      const numericCheck = apiSportsService.lookupEventSync(numericOnly);
                      if (!numericCheck.found) {
                        allLegsValid = false;
                      }
                    } else {
                      allLegsValid = false;
                    }
                  }
                }
                if (!allLegsValid) {
                  rejectedOnChainBets.add(betObjectId);
                  console.warn(`🚫 EXPLOIT BLOCKED: Rejecting bet ${betObjectId.slice(0, 12)}... - Event ${eventId} not found in our system`);
                  continue;
                }
              } else {
                let dbVerified = false;
                try {
                  const { db: verifyDb } = await import('../db');
                  const { sql: verifySql } = await import('drizzle-orm');
                  const { bets: betsVerify } = await import('@shared/schema');
                  const dbCheck = await verifyDb.select({ id: betsVerify.id })
                    .from(betsVerify)
                    .where(verifySql`${betsVerify.externalEventId} = ${eventId}`)
                    .limit(1);
                  if (dbCheck.length > 0) {
                    dbVerified = true;
                    console.log(`✅ On-chain sync: Event ${eventId} verified via existing DB bets`);
                  }
                } catch (dbVerifyErr) {}
                if (!dbVerified) {
                  rejectedOnChainBets.add(betObjectId);
                  console.warn(`🚫 EXPLOIT BLOCKED: Rejecting bet ${betObjectId.slice(0, 12)}... - Event ${eventId} not found in our system`);
                  continue;
                }
              }
            }
          } catch (eventCheckError) {
            rejectedOnChainBets.add(betObjectId);
            console.warn(`🚫 EXPLOIT BLOCKED: Rejecting bet ${betObjectId.slice(0, 12)}... - Could not verify event ${eventId}`);
            continue; // Don't sync bets for unverifiable events
          }
          
          // CRITICAL: Check if bet object is SHARED (new contract) or OWNED (legacy contract)
          // Legacy bets from before Jan 27, 2026 are owned objects and cannot be settled by admin
          try {
            const betObj = await this.client.getObject({
              id: betObjectId,
              options: { showOwner: true }
            });
            
            const owner = betObj.data?.owner;
            // If owner is an address (not "Shared"), this is a legacy owned bet - skip it
            if (owner && typeof owner === 'object' && 'AddressOwner' in owner) {
              console.log(`⚠️ SKIPPING legacy owned bet ${betObjectId.slice(0, 12)}... (owned by ${(owner as any).AddressOwner.slice(0, 12)}...)`);
              continue; // Skip legacy owned bets - they cannot be settled
            }
          } catch (ownerCheckError) {
            console.warn(`⚠️ Could not verify bet ownership for ${betObjectId.slice(0, 12)}..., skipping`);
            continue;
          }

          // Get current on-chain status and additional data
          const onChainInfo = await this.getOnChainBetInfo(betObjectId);
          const onChainStatus = onChainInfo?.status || 'pending';
          const marketId = onChainInfo?.marketId || 'match_winner';
          
          // Use prediction from on-chain bet object if event didn't have it
          const finalPrediction = prediction !== 'Unknown' ? prediction : (onChainInfo?.prediction || 'Unknown');

          // Create bet record in database
          const betId = `sync_${betObjectId.slice(0, 16)}_${Date.now()}`;
          const MAX_PAYOUT_SBETS = 1_000_000;
          const MAX_PAYOUT_SUI = 150;
          const MAX_PAYOUT_USDSUI = 4;
          const MAX_WALLET_EXPOSURE_SBETS = 10_000_000;
          const MAX_WALLET_EXPOSURE_SUI = 300;
          const MAX_WALLET_EXPOSURE_USDSUI = 20;
          const MAX_ODDS = 51;

          const maxPay = coinType === 'SBETS' ? MAX_PAYOUT_SBETS : coinType === 'USDSUI' ? MAX_PAYOUT_USDSUI : MAX_PAYOUT_SUI;
          if (potentialPayout > maxPay) {
            rejectedOnChainBets.add(betObjectId);
            console.warn(`🚫 SECURITY: Rejecting synced bet ${betObjectId.slice(0, 12)}... payout ${potentialPayout} exceeds max ${maxPay} ${coinType}`);
            continue;
          }

          if (odds > MAX_ODDS) {
            rejectedOnChainBets.add(betObjectId);
            console.warn(`🚫 SECURITY: Rejecting synced bet ${betObjectId.slice(0, 12)}... odds ${odds} exceed max ${MAX_ODDS}`);
            continue;
          }

          try {
            const { db: expDb } = await import('../db');
            const { sql: expSql } = await import('drizzle-orm');
            const { bets: expBets } = await import('@shared/schema');
            const walletBets = await expDb.select({
              payout: expBets.potentialPayout,
              currency: expBets.currency,
            }).from(expBets)
              .where(expSql`${expBets.userId} = ${bettor} AND ${expBets.status} IN ('pending', 'confirmed')`);
            
            let existingExposure = 0;
            for (const wb of walletBets) {
              if ((wb.currency || 'SBETS') === coinType) {
                existingExposure += Number(wb.payout || 0);
              }
            }
            const maxExposure = coinType === 'SBETS' ? MAX_WALLET_EXPOSURE_SBETS : coinType === 'USDSUI' ? MAX_WALLET_EXPOSURE_USDSUI : MAX_WALLET_EXPOSURE_SUI;
            if (existingExposure + potentialPayout > maxExposure) {
              rejectedOnChainBets.add(betObjectId);
              console.warn(`🚫 SECURITY: Rejecting synced bet ${betObjectId.slice(0, 12)}... wallet exposure ${existingExposure + potentialPayout} exceeds max ${maxExposure} ${coinType}`);
              continue;
            }
          } catch (expErr) {
            rejectedOnChainBets.add(betObjectId);
            console.warn(`🚫 SECURITY: Rejecting synced bet ${betObjectId.slice(0, 12)}... exposure check failed (fail-closed): ${(expErr as any)?.message}`);
            continue;
          }

          const newBet = {
            id: betId,
            oddsId: `onchain_${eventId}`,
            oddsValue: odds,
            eventId: eventId,
            externalEventId: eventId,
            homeTeam: homeTeam || 'Unknown',
            awayTeam: awayTeam || 'Unknown',
            eventName: eventName !== 'Unknown Event' ? eventName : undefined,
            marketId: marketId,
            outcomeId: finalPrediction.toLowerCase().replace(/\s+/g, '_'),
            odds: odds,
            betAmount: stake,
            currency: coinType,
            status: onChainStatus === 'lost' ? 'lost' : 'confirmed',
            prediction: finalPrediction,
            placedAt: timestamp,
            potentialPayout: potentialPayout,
            platformFee: onChainInfo?.platformFee || 0,
            totalDebit: stake,
            paymentMethod: 'wallet' as const,
            onChainBetId: betObjectId,
            userId: bettor,
          };

          await storage.createBet(newBet);
          synced++;
          console.log(`✅ Synced bet ${betObjectId.slice(0, 12)}... from ${bettor.slice(0, 12)}... (${stake} ${coinType}, prediction=${finalPrediction})`);
        } catch (betError: any) {
          errors.push(`Bet sync error: ${betError.message}`);
        }
      }

      if (skippedVoided > 0 || skippedRejected > 0) {
        console.log(`🔄 On-chain sync complete: ${synced} synced, ${skippedVoided} voided/settled skipped, ${skippedRejected} cached-rejected skipped`);
      } else {
        console.log(`🔄 On-chain sync complete: ${synced} bets synced, ${errors.length} errors`);
      }
      return { synced, errors };
    } catch (error: any) {
      console.error('❌ On-chain bet sync failed:', error);
      errors.push(`Sync failed: ${error.message}`);
      return { synced, errors };
    }
  }

  private phantomVoidStatus: { running: boolean; voided: number; skipped: number; errors: string[]; liabilityFreed: number; scanned: number; total: number; startedAt: number; completedAt?: number; scanId?: string } | null = null;
  private activeScanId: string | null = null;

  getPhantomVoidStatus() {
    if (this.phantomVoidStatus?.running) {
      const elapsed = Date.now() - this.phantomVoidStatus.startedAt;
      const STALE_TIMEOUT = 30 * 60 * 1000;
      if (elapsed > STALE_TIMEOUT) {
        console.warn(`⚠️ Phantom void scan stale (running for ${Math.round(elapsed / 60000)}min), marking as timed out`);
        this.phantomVoidStatus.running = false;
        this.phantomVoidStatus.completedAt = Date.now();
        this.phantomVoidStatus.errors.push('Scan timed out after 30 minutes');
        this.activeScanId = null;
      }
    }
    return this.phantomVoidStatus;
  }

  resetPhantomVoidStatus() {
    this.activeScanId = null;
    this.phantomVoidStatus = null;
  }

  canStartPhantomVoid(): { canStart: boolean; error?: string } {
    this.getPhantomVoidStatus();
    if (this.phantomVoidStatus?.running) {
      return { canStart: false, error: 'Void scan already in progress' };
    }
    const keypair = this.getAdminKeypair();
    if (!keypair) {
      return { canStart: false, error: 'Admin private key not configured' };
    }
    return { canStart: true };
  }

  async voidPhantomSbetsBets(): Promise<{ voided: number; errors: string[]; skipped: number; liabilityFreed: number }> {
    if (this.phantomVoidStatus?.running) {
      return { voided: 0, errors: ['Void scan already in progress'], skipped: 0, liabilityFreed: 0 };
    }

    this.phantomVoidStatus = { running: true, voided: 0, skipped: 0, errors: [], liabilityFreed: 0, scanned: 0, total: 0, startedAt: Date.now() };

    const keypair = this.getAdminKeypair();
    if (!keypair) {
      this.phantomVoidStatus = { ...this.phantomVoidStatus, running: false, errors: ['Admin private key not configured'], completedAt: Date.now() };
      return { voided: 0, errors: ['Admin private key not configured'], skipped: 0, liabilityFreed: 0 };
    }

    try {
      console.log('🔍 Scanning for phantom SBETS bets to void...');

      const sbetsBetObjects: { id: string; stake: number; potentialPayout: number }[] = [];
      const seenIds = new Set<string>();
      let cursor: any = null;
      let hasMore = true;
      let totalEvents = 0;

      while (hasMore) {
        const queryParams: any = {
          query: { MoveEventType: `${BETTING_PACKAGE_ID}::betting::BetPlaced` },
          limit: 50,
          order: 'descending' as const
        };
        if (cursor) queryParams.cursor = cursor;

        const eventsResponse = await this.client.queryEvents(queryParams);
        totalEvents += eventsResponse.data.length;

        for (const event of eventsResponse.data) {
          const parsed = event.parsedJson as any;
          const betObjectId = parsed.bet_id;
          if (parsed.coin_type !== 1) continue;
          if (seenIds.has(betObjectId)) continue;
          seenIds.add(betObjectId);

          sbetsBetObjects.push({
            id: betObjectId,
            stake: parseInt(parsed.stake) / 1e9,
            potentialPayout: parseInt(parsed.potential_payout) / 1e9,
          });
        }

        hasMore = eventsResponse.hasNextPage && eventsResponse.data.length > 0;
        cursor = eventsResponse.nextCursor;
      }

      console.log(`📊 Scanned ${totalEvents} BetPlaced events total`);
      console.log(`🎯 Found ${sbetsBetObjects.length} unique SBETS bet objects to check`);
      this.phantomVoidStatus.total = sbetsBetObjects.length;

      for (const betObj of sbetsBetObjects) {
        this.phantomVoidStatus.scanned++;
        try {
          const obj = await this.client.getObject({
            id: betObj.id,
            options: { showContent: true },
          });

          if (!obj.data?.content || obj.data.content.dataType !== 'moveObject') {
            this.phantomVoidStatus.skipped++;
            continue;
          }

          const fields = (obj.data.content as any).fields;
          const status = parseInt(fields.status || '0');

          if (status !== 0) {
            this.phantomVoidStatus.skipped++;
            continue;
          }

          const ownerInfo = obj.data.owner;
          const isObjectOwned = typeof ownerInfo === 'object' && ownerInfo !== null && 'AddressOwner' in ownerInfo;
          
          if (isObjectOwned) {
            this.phantomVoidStatus.skipped++;
            continue;
          }

          console.log(`🗑️ Voiding phantom SBETS bet ${betObj.id.slice(0, 12)}... (liability: ${betObj.potentialPayout.toFixed(2)} SBETS)`);

          const result = await this.executePhantomVoidSbetsOnChain(betObj.id);
          if (result.success) {
            this.phantomVoidStatus.voided++;
            this.phantomVoidStatus.liabilityFreed += betObj.potentialPayout;
            console.log(`✅ Voided: ${betObj.id.slice(0, 12)}... freed ${betObj.potentialPayout.toFixed(2)} SBETS liability | TX: ${result.txHash}`);
          } else {
            this.phantomVoidStatus.errors.push(`Failed to void ${betObj.id.slice(0, 12)}...: ${result.error}`);
            console.warn(`❌ Failed to void ${betObj.id.slice(0, 12)}...: ${result.error}`);
          }

          await new Promise(r => setTimeout(r, 2000));
        } catch (err: any) {
          this.phantomVoidStatus.errors.push(`Error processing ${betObj.id.slice(0, 12)}...: ${err.message}`);
        }
      }

      const { voided, skipped, errors, liabilityFreed } = this.phantomVoidStatus;
      console.log(`🏁 Phantom void complete: ${voided} voided, ${skipped} skipped, ${errors.length} errors, ${liabilityFreed.toFixed(2)} SBETS freed`);
      this.phantomVoidStatus.running = false;
      this.phantomVoidStatus.completedAt = Date.now();
      return { voided, errors: [...errors], skipped, liabilityFreed };
    } catch (error: any) {
      console.error('❌ Phantom void scan failed:', error);
      this.phantomVoidStatus.errors.push(`Scan failed: ${error.message}`);
      this.phantomVoidStatus.running = false;
      this.phantomVoidStatus.completedAt = Date.now();
      return { voided: this.phantomVoidStatus.voided, errors: [...this.phantomVoidStatus.errors], skipped: this.phantomVoidStatus.skipped, liabilityFreed: this.phantomVoidStatus.liabilityFreed };
    }
  }

  async voidAllPhantomBets(): Promise<{ voided: number; errors: string[]; skipped: number; liabilityFreed: number }> {
    if (this.phantomVoidStatus?.running) {
      return { voided: 0, errors: ['Void scan already in progress'], skipped: 0, liabilityFreed: 0 };
    }

    const scanId = `scan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.activeScanId = scanId;
    this.phantomVoidStatus = { running: true, voided: 0, skipped: 0, errors: [], liabilityFreed: 0, scanned: 0, total: 0, startedAt: Date.now(), scanId };

    const keypair = this.getAdminKeypair();
    if (!keypair) {
      this.phantomVoidStatus = { ...this.phantomVoidStatus, running: false, errors: ['Admin private key not configured'], completedAt: Date.now() };
      return { voided: 0, errors: ['Admin private key not configured'], skipped: 0, liabilityFreed: 0 };
    }

    try {
      console.log('🔍 Scanning ALL phantom bets (SUI + SBETS) to void...');

      const allBetObjects: { id: string; stake: number; potentialPayout: number; coinType: number }[] = [];
      const seenIds = new Set<string>();
      let cursor: any = null;
      let hasMore = true;
      let totalEvents = 0;

      while (hasMore) {
        const queryParams: any = {
          query: { MoveEventType: `${BETTING_PACKAGE_ID}::betting::BetPlaced` },
          limit: 50,
          order: 'descending' as const
        };
        if (cursor) queryParams.cursor = cursor;

        const eventsResponse = await this.client.queryEvents(queryParams);
        totalEvents += eventsResponse.data.length;

        for (const event of eventsResponse.data) {
          const parsed = event.parsedJson as any;
          const betObjectId = parsed.bet_id;
          if (seenIds.has(betObjectId)) continue;
          seenIds.add(betObjectId);

          const parsedCoinType = parseInt(parsed.coin_type || '0');
          const parsedDecimals = parsedCoinType === 2 ? 1e6 : 1e9;
          allBetObjects.push({
            id: betObjectId,
            stake: parseInt(parsed.stake) / parsedDecimals,
            potentialPayout: parseInt(parsed.potential_payout) / parsedDecimals,
            coinType: parsedCoinType,
          });
        }

        hasMore = eventsResponse.hasNextPage && eventsResponse.data.length > 0;
        cursor = eventsResponse.nextCursor;
      }

      console.log(`📊 Scanned ${totalEvents} BetPlaced events, found ${allBetObjects.length} unique bet objects`);
      this.phantomVoidStatus.total = allBetObjects.length;

      const { db } = await import('../db');
      const { sql } = await import('drizzle-orm');
      const { bets } = await import('@shared/schema');

      const getObjectWithRetry = async (id: string, maxRetries = 3): Promise<any> => {
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          try {
            return await this.client.getObject({ id, options: { showContent: true } });
          } catch (err: any) {
            if ((err.message?.includes('429') || err.message?.includes('rate')) && attempt < maxRetries) {
              const backoff = Math.min(2000 * Math.pow(2, attempt), 10000);
              await new Promise(r => setTimeout(r, backoff));
              continue;
            }
            throw err;
          }
        }
      };

      for (const betObj of allBetObjects) {
        if (this.activeScanId !== scanId) {
          console.log('🛑 Scan aborted (reset by admin)');
          return { voided: this.phantomVoidStatus?.voided || 0, errors: ['Scan aborted by admin reset'], skipped: this.phantomVoidStatus?.skipped || 0, liabilityFreed: this.phantomVoidStatus?.liabilityFreed || 0 };
        }
        this.phantomVoidStatus.scanned++;
        try {
          const obj = await getObjectWithRetry(betObj.id);

          if (!obj.data?.content || obj.data.content.dataType !== 'moveObject') {
            this.phantomVoidStatus.skipped++;
            continue;
          }

          const fields = (obj.data.content as any).fields;
          const status = parseInt(fields.status || '0');

          if (status !== 0) {
            this.phantomVoidStatus.skipped++;
            continue;
          }

          const ownerInfo = obj.data.owner;
          const isObjectOwned = typeof ownerInfo === 'object' && ownerInfo !== null && 'AddressOwner' in ownerInfo;

          if (isObjectOwned) {
            this.phantomVoidStatus.skipped++;
            continue;
          }

          const dbCheck = await db.select({ id: bets.id }).from(bets)
            .where(sql`${bets.betObjectId} = ${betObj.id} AND ${bets.status} IN ('pending', 'confirmed')`)
            .limit(1);

          if (dbCheck.length > 0) {
            this.phantomVoidStatus.skipped++;
            continue;
          }

          const coinLabel = betObj.coinType === 1 ? 'SBETS' : betObj.coinType === 2 ? 'USDSUI' : 'SUI';
          console.log(`🗑️ Voiding phantom ${coinLabel} bet ${betObj.id.slice(0, 12)}... (liability: ${betObj.potentialPayout.toFixed(2)} ${coinLabel})`);

          let result;
          if (betObj.coinType === 1) {
            result = await this.executePhantomVoidSbetsOnChain(betObj.id);
          } else if (betObj.coinType === 2) {
            result = await this.executePhantomVoidUsdsuiOnChain(betObj.id);
          } else {
            result = await this.executePhantomVoidSuiOnChain(betObj.id);
          }

          if (result.success) {
            this.phantomVoidStatus.voided++;
            this.phantomVoidStatus.liabilityFreed += betObj.potentialPayout;
            rejectedOnChainBets.add(betObj.id);
            console.log(`✅ Voided: ${betObj.id.slice(0, 12)}... freed ${betObj.potentialPayout.toFixed(2)} ${coinLabel} liability | TX: ${result.txHash}`);
          } else {
            this.phantomVoidStatus.errors.push(`Failed to void ${betObj.id.slice(0, 12)}...: ${result.error}`);
            console.warn(`❌ Failed to void ${betObj.id.slice(0, 12)}...: ${result.error}`);
          }

          await new Promise(r => setTimeout(r, 2000));
        } catch (err: any) {
          this.phantomVoidStatus.errors.push(`Error processing ${betObj.id.slice(0, 12)}...: ${err.message}`);
        }
      }

      const { voided, skipped, errors, liabilityFreed } = this.phantomVoidStatus;
      console.log(`🏁 All phantom void complete: ${voided} voided, ${skipped} skipped, ${errors.length} errors, ${liabilityFreed.toFixed(2)} total liability freed`);
      this.phantomVoidStatus.running = false;
      this.phantomVoidStatus.completedAt = Date.now();
      return { voided, errors: [...errors], skipped, liabilityFreed };
    } catch (error: any) {
      console.error('❌ All phantom void scan failed:', error);
      this.phantomVoidStatus.errors.push(`Scan failed: ${error.message}`);
      this.phantomVoidStatus.running = false;
      this.phantomVoidStatus.completedAt = Date.now();
      return { voided: this.phantomVoidStatus.voided, errors: [...this.phantomVoidStatus.errors], skipped: this.phantomVoidStatus.skipped, liabilityFreed: this.phantomVoidStatus.liabilityFreed };
    }
  }

  async depositLiquiditySbets(amount: number): Promise<{ success: boolean; txHash?: string; error?: string; deposited?: number }> {
    const keypair = this.getAdminKeypair();
    if (!keypair) {
      return { success: false, error: 'Admin private key not configured' };
    }

    try {
      const adminCapId = ADMIN_CAP_ID;
      if (!adminCapId) {
        return { success: false, error: 'ADMIN_CAP_ID not configured' };
      }

      const amountInSmallest = BigInt(Math.floor(amount * 1_000_000_000));
      const SBETS_TYPE = SBETS_COIN_TYPE;

      const coins = await this.client.getCoins({
        owner: keypair.toSuiAddress(),
        coinType: SBETS_TYPE,
      });

      if (!coins.data || coins.data.length === 0) {
        return { success: false, error: 'No SBETS coins found in admin wallet. Send SBETS to admin wallet first.' };
      }

      const totalBalance = coins.data.reduce((sum, c) => sum + BigInt(c.balance), BigInt(0));
      if (totalBalance < amountInSmallest) {
        return { success: false, error: `Insufficient SBETS in admin wallet: ${Number(totalBalance) / 1e9} < ${amount}. Send more SBETS to admin wallet.` };
      }

      const tx = new Transaction();
      const coinIds = coins.data.map(c => c.coinObjectId);
      
      let paymentCoin;
      if (coinIds.length > 1) {
        tx.mergeCoins(tx.object(coinIds[0]), coinIds.slice(1).map(id => tx.object(id)));
      }
      [paymentCoin] = tx.splitCoins(tx.object(coinIds[0]), [amountInSmallest]);

      tx.moveCall({
        target: `${BETTING_PACKAGE_ID}::betting::deposit_liquidity_sbets`,
        arguments: [
          tx.object(adminCapId),
          tx.object(BETTING_PLATFORM_ID),
          paymentCoin,
          tx.object('0x6'),
        ],
      });

      const result = await this.client.signAndExecuteTransaction({
        transaction: tx,
        signer: keypair,
        options: { showEffects: true },
      });

      const status = result.effects?.status?.status;
      if (status === 'success') {
        console.log(`✅ Deposited ${amount} SBETS to treasury | TX: ${result.digest}`);
        return { success: true, txHash: result.digest, deposited: amount };
      } else {
        const error = result.effects?.status?.error || 'Transaction failed';
        return { success: false, error };
      }
    } catch (error: any) {
      console.error('❌ SBETS deposit error:', error);
      return { success: false, error: error.message };
    }
  }

  async resetOnChainLiability(currency: 'SUI' | 'SBETS', newLiability: number): Promise<{ success: boolean; txHash?: string; error?: string }> {
    const keypair = this.getAdminKeypair();
    if (!keypair) {
      return { success: false, error: 'Admin private key not configured' };
    }

    if (!ADMIN_CAP_ID) {
      return { success: false, error: 'ADMIN_CAP_ID not configured' };
    }

    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const adminCapId = ADMIN_CAP_ID;

        const functionName = currency === 'SBETS' ? 'admin_reset_liability_sbets' : 'admin_reset_liability_sui';
        const liabilityValue = BigInt(Math.floor(newLiability * 1_000_000_000));

        const tx = new Transaction();
        tx.moveCall({
          target: `${BETTING_PACKAGE_ID}::betting::${functionName}`,
          arguments: [
            tx.object(adminCapId),
            tx.object(BETTING_PLATFORM_ID),
            tx.pure.u64(liabilityValue),
          ],
        });

        const result = await this.client.signAndExecuteTransaction({
          transaction: tx,
          signer: keypair,
          options: { showEffects: true },
        });

        const status = result.effects?.status?.status;
        if (status === 'success') {
          console.log(`✅ On-chain ${currency} liability reset to ${newLiability} | TX: ${result.digest}`);
          return { success: true, txHash: result.digest };
        } else {
          const error = result.effects?.status?.error || 'Transaction failed';
          console.error(`❌ Liability reset failed: ${error}`);
          return { success: false, error };
        }
      } catch (error: any) {
        const isVersionConflict = error.message?.includes('not available for consumption') || error.message?.includes('ObjectVersionUnavailableForConsumption');
        if (isVersionConflict && attempt < maxRetries) {
          console.warn(`⚠️ Liability reset version conflict (attempt ${attempt}/${maxRetries}) — retrying in ${attempt * 2}s...`);
          await new Promise(resolve => setTimeout(resolve, attempt * 2000));
          continue;
        }
        console.error(`❌ Liability reset error:`, error);
        return { success: false, error: error.message };
      }
    }
    return { success: false, error: 'Max retries exceeded' };
  }

}

export const blockchainBetService = new BlockchainBetService();
export default blockchainBetService;
