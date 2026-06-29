import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';

const QUOTE_VALIDITY_MS = 5 * 60 * 1000;

class OracleSigningService {
  private keypair: Ed25519Keypair | null = null;
  private publicKeyBytes: Uint8Array | null = null;

  constructor() {
    const privKey = process.env.ORACLE_SIGNING_KEY;
    if (!privKey) {
      console.warn('⚠️ ORACLE_SIGNING_KEY not set — oracle signing disabled, bets will fail on-chain');
      return;
    }

    try {
      if (privKey.startsWith('suiprivkey')) {
        const { secretKey } = decodeSuiPrivateKey(privKey);
        this.keypair = Ed25519Keypair.fromSecretKey(secretKey);
      } else {
        const keyBytes = Buffer.from(privKey, 'hex');
        this.keypair = Ed25519Keypair.fromSecretKey(keyBytes);
      }
      this.publicKeyBytes = this.keypair.getPublicKey().toRawBytes();
      console.log('✅ Oracle signing service initialized');
      console.log(`   Public key (hex): ${Buffer.from(this.publicKeyBytes).toString('hex')}`);
      console.log(`   Public key (bytes): [${Array.from(this.publicKeyBytes).join(', ')}]`);
    } catch (err) {
      console.error('❌ Failed to initialize oracle signing key:', err);
      this.keypair = null;
    }
  }

  isReady(): boolean {
    return this.keypair !== null;
  }

  getPublicKeyHex(): string {
    if (!this.publicKeyBytes) return '';
    return Buffer.from(this.publicKeyBytes).toString('hex');
  }

  getPublicKeyBytes(): number[] {
    if (!this.publicKeyBytes) return [];
    return Array.from(this.publicKeyBytes);
  }

  private buildMessage(eventIdBytes: Uint8Array, oddsBps: number, quoteExpiry: number, walletAddress: string, prediction: string): Uint8Array {
    const oddsBuffer = new ArrayBuffer(8);
    const oddsView = new DataView(oddsBuffer);
    oddsView.setBigUint64(0, BigInt(oddsBps), true);

    const expiryBuffer = new ArrayBuffer(8);
    const expiryView = new DataView(expiryBuffer);
    expiryView.setBigUint64(0, BigInt(quoteExpiry), true);

    const walletBytes = Buffer.from(walletAddress.toLowerCase().replace(/^0x/, ''), 'hex');

    const predictionBytes = new TextEncoder().encode(prediction);

    const msg = new Uint8Array(eventIdBytes.length + 8 + 8 + walletBytes.length + predictionBytes.length);
    let offset = 0;
    msg.set(eventIdBytes, offset); offset += eventIdBytes.length;
    msg.set(new Uint8Array(oddsBuffer), offset); offset += 8;
    msg.set(new Uint8Array(expiryBuffer), offset); offset += 8;
    msg.set(walletBytes, offset); offset += walletBytes.length;
    msg.set(predictionBytes, offset);
    return msg;
  }

  async signBetQuote(eventId: string, oddsBps: number, walletAddress: string, prediction: string): Promise<{
    signature: number[];
    quoteExpiry: number;
    oraclePublicKey: number[];
  } | null> {
    if (!this.keypair || !this.publicKeyBytes) {
      console.error('Oracle signing service not initialized');
      return null;
    }

    if (!walletAddress || !prediction) {
      console.error('Oracle signing requires walletAddress and prediction');
      return null;
    }

    const quoteExpiry = Date.now() + QUOTE_VALIDITY_MS;
    const eventIdBytes = new TextEncoder().encode(eventId);
    const msg = this.buildMessage(eventIdBytes, oddsBps, quoteExpiry, walletAddress, prediction);

    const signature = await this.keypair.sign(msg);

    return {
      signature: Array.from(signature),
      quoteExpiry,
      oraclePublicKey: Array.from(this.publicKeyBytes),
    };
  }
  async signNftMint(walletAddress: string, blobId: string, payout: string, currency: string): Promise<{
    signature: number[];
  } | null> {
    if (!this.keypair || !this.publicKeyBytes) {
      console.error('Oracle signing service not initialized');
      return null;
    }

    const hex = walletAddress.toLowerCase().replace(/^0x/, '').padStart(64, '0');
    const walletBytes = Buffer.from(hex, 'hex');
    if (walletBytes.length !== 32) {
      console.error(`[NFT] Invalid wallet bytes length: ${walletBytes.length}, expected 32`);
      return null;
    }
    const blobIdBytes = new TextEncoder().encode(blobId);
    const payoutBytes = new TextEncoder().encode(payout);
    const currencyBytes = new TextEncoder().encode(currency);

    const msg = new Uint8Array(32 + blobIdBytes.length + payoutBytes.length + currencyBytes.length);
    let offset = 0;
    msg.set(walletBytes, offset); offset += 32;
    msg.set(blobIdBytes, offset); offset += blobIdBytes.length;
    msg.set(payoutBytes, offset); offset += payoutBytes.length;
    msg.set(currencyBytes, offset);

    const signature = await this.keypair.sign(msg);

    return {
      signature: Array.from(signature),
    };
  }
}

export const oracleSigningService = new OracleSigningService();
