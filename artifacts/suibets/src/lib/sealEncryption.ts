/**
 * Seal-compatible E2E Encryption
 * Real AES-256-GCM client-side encryption for SuiBets chat.
 * Key material is derived from a deterministic wallet signature — the server
 * stores only ciphertext and can never read message contents.
 *
 * Architecture mirrors Sui Seal IBE: identity = wallet address,
 * key = HKDF(wallet_signature, room_id). No server key escrow.
 */

const SIGN_MESSAGE = 'SuiBets chat identity v1 — sign to unlock encrypted messages';
const HKDF_INFO = new TextEncoder().encode('SuiBets:AES-GCM:room-key:v1');

let cachedSignature: Uint8Array | null = null;
let cachedAddress: string | null = null;

export function resetSealSession(): void {
  cachedSignature = null;
  cachedAddress = null;
}

async function deriveRoomKey(signature: Uint8Array, roomId: number | string): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey('raw', signature, { name: 'HKDF' }, false, ['deriveKey']);
  const salt = new TextEncoder().encode(`room:${roomId}`);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: HKDF_INFO },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function getOrRequestSignature(
  walletAddress: string,
  signPersonalMessage: (msg: { message: Uint8Array }) => Promise<{ signature: string }>,
): Promise<Uint8Array> {
  if (cachedSignature && cachedAddress === walletAddress) {
    return cachedSignature;
  }

  const msgBytes = new TextEncoder().encode(SIGN_MESSAGE);
  const { signature } = await signPersonalMessage({ message: msgBytes });

  const sigBytes = typeof signature === 'string'
    ? Uint8Array.from(atob(signature), c => c.charCodeAt(0))
    : new Uint8Array(signature as any);

  cachedSignature = sigBytes;
  cachedAddress = walletAddress;
  return sigBytes;
}

export async function encryptMessage(
  plaintext: string,
  roomId: number | string,
  walletAddress: string,
  signPersonalMessage: (msg: { message: Uint8Array }) => Promise<{ signature: string }>,
): Promise<string> {
  const sig = await getOrRequestSignature(walletAddress, signPersonalMessage);
  const key = await deriveRoomKey(sig, roomId);

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);

  const combined = new Uint8Array(iv.length + new Uint8Array(ciphertext).length);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);

  return `seal:v1:${btoa(String.fromCharCode(...combined))}`;
}

export async function decryptMessage(
  encryptedContent: string,
  roomId: number | string,
  walletAddress: string,
  signPersonalMessage: (msg: { message: Uint8Array }) => Promise<{ signature: string }>,
): Promise<string> {
  if (!encryptedContent.startsWith('seal:v1:')) {
    return encryptedContent;
  }

  try {
    const b64 = encryptedContent.slice('seal:v1:'.length);
    const combined = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);

    const sig = await getOrRequestSignature(walletAddress, signPersonalMessage);
    const key = await deriveRoomKey(sig, roomId);

    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    return new TextDecoder().decode(decrypted);
  } catch {
    return '🔒 [encrypted — open room to decrypt]';
  }
}

export function isSealEncrypted(content: string): boolean {
  return content.startsWith('seal:v1:');
}

export function getSealStatus(): { active: boolean; identity: string | null } {
  return {
    active: cachedSignature !== null,
    identity: cachedAddress,
  };
}
