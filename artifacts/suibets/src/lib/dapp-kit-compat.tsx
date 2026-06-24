import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  useCurrentAccount as _useCurrentAccount,
  useCurrentWallet as _useCurrentWallet,
  useWallets as _useWallets,
  useConnectWallet as _useConnectWallet,
  useDisconnectWallet as _useDisconnectWallet,
  useSuiClient as _useSuiClient,
  useSignAndExecuteTransaction as _useSignAndExecuteTransaction,
  useSignPersonalMessage as _useSignPersonalMessage,
  useSignTransaction as _useSignTransaction,
  useSuiClientQuery as _useSuiClientQuery,
} from '@mysten/dapp-kit';

// ── Direct re-exports ─────────────────────────────────────────────────────────
export const useCurrentAccount  = _useCurrentAccount;
export const useWallets         = _useWallets;
export const useCurrentWallet   = _useCurrentWallet;
export const useConnectWallet   = _useConnectWallet;
export const useDisconnectWallet = _useDisconnectWallet;

// ── Sui client ────────────────────────────────────────────────────────────────
export function useSuiClient(): any {
  return _useSuiClient();
}

// ── Sign and execute ──────────────────────────────────────────────────────────
// Thin wrapper that normalises the result shape components expect:
// { digest, effects, objectChanges, ... }
export function useSignAndExecuteTransaction() {
  const { mutateAsync: _mutateAsync, isPending } = _useSignAndExecuteTransaction();
  const [pending, setPending] = useState(false);

  const mutateAsync = useCallback(async (input: any) => {
    setPending(true);
    try {
      const result = await _mutateAsync({
        transaction: input.transaction,
      });
      return result;
    } finally {
      setPending(false);
    }
  }, [_mutateAsync]);

  const mutate = useCallback((input: any, options?: any) => {
    mutateAsync(input)
      .then((result) => {
        options?.onSuccess?.(result);
        options?.onSettled?.(result, null);
      })
      .catch((err: any) => {
        options?.onError?.(err);
        options?.onSettled?.(null, err);
      });
  }, [mutateAsync]);

  return { mutate, mutateAsync, isPending: isPending || pending };
}

// ── Sign personal message ─────────────────────────────────────────────────────
export function useSignPersonalMessage() {
  const { mutateAsync: _mutateAsync, isPending } = _useSignPersonalMessage();
  const [pending, setPending] = useState(false);

  const mutateAsync = useCallback(async (input: { message: Uint8Array }) => {
    setPending(true);
    try {
      return await _mutateAsync({ message: input.message });
    } finally {
      setPending(false);
    }
  }, [_mutateAsync]);

  const mutate = useCallback((input: any, options?: any) => {
    mutateAsync(input)
      .then((result) => options?.onSuccess?.(result))
      .catch((err: any) => options?.onError?.(err));
  }, [mutateAsync]);

  return { mutate, mutateAsync, isPending: isPending || pending };
}

// ── Sign transaction ──────────────────────────────────────────────────────────
export function useSignTransaction() {
  const { mutateAsync: _mutateAsync, isPending } = _useSignTransaction();
  const [pending, setPending] = useState(false);

  const mutateAsync = useCallback(async (input: any) => {
    setPending(true);
    try {
      return await _mutateAsync({ transaction: input.transaction });
    } finally {
      setPending(false);
    }
  }, [_mutateAsync]);

  const mutate = useCallback((input: any, options?: any) => {
    mutateAsync(input)
      .then((result) => options?.onSuccess?.(result))
      .catch((err: any) => options?.onError?.(err));
  }, [mutateAsync]);

  return { mutate, mutateAsync, isPending: isPending || pending };
}

// ── Sui client query ──────────────────────────────────────────────────────────
export function useSuiClientQuery(
  method: string,
  params?: Record<string, any>,
  options?: { enabled?: boolean; refetchInterval?: number }
) {
  const client = _useSuiClient() as any;
  const enabled = options?.enabled !== false && !!client;

  return useQuery({
    queryKey: ['sui-client', method, params],
    queryFn: async () => {
      if (!client || !client[method]) {
        throw new Error(`SuiClient method "${method}" not found`);
      }
      return client[method](params || {});
    },
    enabled,
    refetchInterval: options?.refetchInterval,
  });
}

// ── Simple connect button (fallback — app uses ConnectWalletModal instead) ────
export function ConnectButton() {
  const account = _useCurrentAccount();
  const wallets = _useWallets();
  const { mutate: connect } = _useConnectWallet();
  const { mutate: disconnect } = _useDisconnectWallet();
  const [showMenu, setShowMenu] = useState(false);

  if (account) {
    return (
      <button
        data-testid="button-disconnect-wallet"
        onClick={() => disconnect()}
        style={{
          padding: '8px 16px',
          borderRadius: '8px',
          border: '1px solid #333',
          background: '#1a1a2e',
          color: '#fff',
          cursor: 'pointer',
          fontSize: '14px',
        }}
      >
        {account.address.slice(0, 6)}...{account.address.slice(-4)}
      </button>
    );
  }

  return (
    <div style={{ position: 'relative' }}>
      <button
        data-testid="button-connect-wallet"
        onClick={() => setShowMenu(!showMenu)}
        style={{
          padding: '8px 16px',
          borderRadius: '8px',
          border: '1px solid #4da2ff',
          background: '#4da2ff',
          color: '#fff',
          cursor: 'pointer',
          fontSize: '14px',
          fontWeight: 600,
        }}
      >
        Connect Wallet
      </button>
      {showMenu && wallets.length > 0 && (
        <div
          style={{
            position: 'absolute',
            top: '110%',
            right: 0,
            background: '#1a1a2e',
            border: '1px solid #333',
            borderRadius: '8px',
            padding: '8px',
            zIndex: 9999,
            minWidth: '200px',
          }}
        >
          {wallets.map((w) => (
            <button
              key={w.name}
              data-testid={`button-wallet-${w.name}`}
              onClick={() => {
                connect({ wallet: w });
                setShowMenu(false);
              }}
              style={{
                display: 'block',
                width: '100%',
                padding: '8px 12px',
                marginBottom: '4px',
                borderRadius: '6px',
                border: 'none',
                background: 'transparent',
                color: '#fff',
                cursor: 'pointer',
                textAlign: 'left',
                fontSize: '14px',
              }}
            >
              {w.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
