/**
 * PasskeyContext — Face ID / Touch ID / Windows Hello betting
 *
 * Uses @mysten/sui PasskeyKeypair (WebAuthn / FIDO2) to create a Sui wallet
 * derived from the device's secure enclave.  The private key never leaves the
 * device — biometric auth is required for every signing operation.
 *
 * Storage: suibets_passkey_v2 in localStorage
 *   { credentialId: base64, pubkey: base64, address: '0x...' }
 *
 * Security:
 *   - Origin-bound (rpId = hostname — credential usable only on suibets.com)
 *   - Device-bound (lives in TPM / Secure Enclave — can't be exported)
 *   - userVerification: "required" (biometric always prompted on every sign)
 *   - No private key stored anywhere outside the device
 */

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import { PasskeyKeypair, BrowserPasskeyProvider } from '@mysten/sui/keypairs/passkey';
import { Transaction } from '@mysten/sui/transactions';
import { fromBase64, toBase64 } from '@mysten/bcs';

// Minimal SuiClient duck-type — avoids import path differences between @mysten/sui v1 and v2
interface SuiClientLike {
  executeTransactionBlock(params: {
    transactionBlock: Uint8Array;
    signature: string | string[];
    options?: Record<string, unknown>;
  }): Promise<{ digest: string }>;
}

const STORAGE_KEY = 'suibets_passkey_v2';
const APP_NAME    = 'SuiBets';

interface StoredPasskey {
  credentialId: string;   // base64-encoded Uint8Array
  pubkey:       string;   // base64-encoded compressed P-256 point (33 bytes)
  address:      string;   // Sui address 0x...
}

interface PasskeyContextValue {
  isSupported:    boolean;
  hasPasskey:     boolean;
  passkeyAddress: string | null;
  isCreating:     boolean;
  isSigning:      boolean;
  error:          string | null;

  createPasskey:        () => Promise<string | null>;
  clearPasskey:         () => void;
  signAndExecuteTx:     (tx: Transaction, suiClient: SuiClientLike) => Promise<string>;
  getStoredPasskey:     () => StoredPasskey | null;
}

const PasskeyContext = createContext<PasskeyContextValue | null>(null);

function isWebAuthnSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential !== 'undefined' &&
    typeof navigator.credentials?.create === 'function' &&
    window.isSecureContext
  );
}

function makeProvider(): BrowserPasskeyProvider {
  return new BrowserPasskeyProvider(APP_NAME, {
    rp: { id: window.location.hostname, name: APP_NAME },
    user: {
      name:        APP_NAME,
      displayName: APP_NAME,
    },
    authenticatorSelection: {
      userVerification: 'required',
      residentKey:      'preferred',
    },
    timeout: 120_000,
  });
}

function loadStored(): StoredPasskey | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StoredPasskey;
  } catch {
    return null;
  }
}

function saveStored(data: StoredPasskey): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function PasskeyProvider({ children }: { children: ReactNode }) {
  const [supported]       = useState(() => isWebAuthnSupported());
  const [stored, setStored] = useState<StoredPasskey | null>(() => loadStored());
  const [isCreating, setIsCreating] = useState(false);
  const [isSigning,  setIsSigning]  = useState(false);
  const [error,      setError]      = useState<string | null>(null);

  // Re-read from storage on focus (e.g. user set up passkey in another tab)
  useEffect(() => {
    const handler = () => setStored(loadStored());
    window.addEventListener('focus', handler);
    window.addEventListener('suibets:passkey-created', handler);
    return () => {
      window.removeEventListener('focus', handler);
      window.removeEventListener('suibets:passkey-created', handler);
    };
  }, []);

  const createPasskey = useCallback(async (): Promise<string | null> => {
    if (!supported) {
      setError('WebAuthn / passkeys are not supported in this browser or context.');
      return null;
    }
    setIsCreating(true);
    setError(null);
    try {
      const provider = makeProvider();
      const keypair  = await PasskeyKeypair.getPasskeyInstance(provider);

      const address      = keypair.toSuiAddress();
      const credentialId = keypair.getCredentialId();  // Uint8Array | undefined
      const pubkeyBytes  = keypair.getPublicKey().toRawBytes(); // compressed P-256 (33 bytes)

      if (!credentialId) throw new Error('Credential ID missing from passkey response');

      const data: StoredPasskey = {
        credentialId: toBase64(credentialId),
        pubkey:       toBase64(pubkeyBytes),
        address,
      };

      saveStored(data);
      setStored(data);
      window.dispatchEvent(new Event('suibets:passkey-created'));
      return address;
    } catch (err: any) {
      const msg = err?.message ?? 'Passkey creation failed';
      // User cancelled — don't show as error
      if (msg.includes('cancelled') || msg.includes('NotAllowedError') || msg.includes('abort')) {
        setError(null);
      } else {
        setError(msg);
      }
      return null;
    } finally {
      setIsCreating(false);
    }
  }, [supported]);

  const clearPasskey = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setStored(null);
    setError(null);
  }, []);

  const getStoredPasskey = useCallback((): StoredPasskey | null => {
    return loadStored();
  }, []);

  /**
   * Sign and execute a Transaction using the stored passkey.
   * Returns the transaction digest.
   */
  const signAndExecuteTx = useCallback(async (
    tx: Transaction,
    suiClient: SuiClientLike,
  ): Promise<string> => {
    const s = loadStored();
    if (!s) throw new Error('No passkey wallet set up. Please create one first.');
    if (!supported) throw new Error('WebAuthn not supported in this context.');

    setIsSigning(true);
    setError(null);
    try {
      const provider = makeProvider();
      const pubkeyBytes  = fromBase64(s.pubkey);
      const credentialId = fromBase64(s.credentialId);

      const keypair = new PasskeyKeypair(
        pubkeyBytes,
        provider,
        credentialId,
      );

      // Build transaction bytes — cast to any since duck-type satisfies runtime needs
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const txBytes = await tx.build({ client: suiClient as any });

      // Sign — this triggers the WebAuthn/biometric prompt on the device
      const { signature } = await keypair.signTransaction(txBytes);

      // Execute on-chain
      const result = await suiClient.executeTransactionBlock({
        transactionBlock: txBytes,
        signature,
        options: { showEffects: true },
      });

      const digest = result.digest;
      if (!digest) throw new Error('Transaction executed but no digest returned');

      return digest;
    } catch (err: any) {
      const msg = err?.message ?? 'Transaction signing failed';
      setError(msg);
      throw err;
    } finally {
      setIsSigning(false);
    }
  }, [supported]);

  const value: PasskeyContextValue = {
    isSupported:    supported,
    hasPasskey:     !!stored,
    passkeyAddress: stored?.address ?? null,
    isCreating,
    isSigning,
    error,
    createPasskey,
    clearPasskey,
    signAndExecuteTx,
    getStoredPasskey,
  };

  return (
    <PasskeyContext.Provider value={value}>
      {children}
    </PasskeyContext.Provider>
  );
}

export function usePasskey(): PasskeyContextValue {
  const ctx = useContext(PasskeyContext);
  if (!ctx) throw new Error('usePasskey must be used inside <PasskeyProvider>');
  return ctx;
}
