import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  useCurrentAccount as _useCurrentAccount,
  useCurrentClient as _useCurrentClient,
  useCurrentWallet as _useCurrentWallet,
  useWallets as _useWallets,
  useDAppKit,
  useWalletConnection,
} from '@mysten/dapp-kit-react';
export const useCurrentAccount = _useCurrentAccount;
export const useWallets = _useWallets;
export const useCurrentWallet = _useCurrentWallet;

export function useSuiClient(): any {
  return _useCurrentClient();
}

export function useSignAndExecuteTransaction() {
  const dappKit = useDAppKit();
  const [isPending, setIsPending] = useState(false);

  const mutateAsync = useCallback(async (input: any) => {
    setIsPending(true);
    try {
      const raw = await dappKit.signAndExecuteTransaction({
        transaction: input.transaction,
        network: input.chain?.replace('sui:', '') || undefined,
      });
      if (raw && typeof raw === 'object' && 'FailedTransaction' in raw) {
        const failed = (raw as any).FailedTransaction;
        throw new Error(failed?.status?.error?.message || 'Transaction failed on-chain');
      }
      if (raw && typeof raw === 'object' && 'Transaction' in raw) {
        const tx = (raw as any).Transaction;
        return {
          digest: tx.digest,
          effects: tx.effects,
          objectChanges: tx.objectChanges,
          ...tx,
        };
      }
      return raw;
    } finally {
      setIsPending(false);
    }
  }, [dappKit]);

  const mutate = useCallback((input: any, options?: any) => {
    mutateAsync(input)
      .then((result) => {
        options?.onSuccess?.(result);
        options?.onSettled?.(result, null);
      })
      .catch((err) => {
        options?.onError?.(err);
        options?.onSettled?.(null, err);
      });
  }, [mutateAsync]);

  return { mutate, mutateAsync, isPending };
}

export function useSignTransaction() {
  const dappKit = useDAppKit();
  const [isPending, setIsPending] = useState(false);

  const mutateAsync = useCallback(async (input: any) => {
    setIsPending(true);
    try {
      const result = await dappKit.signTransaction({
        transaction: input.transaction,
        network: input.chain?.replace('sui:', '') || undefined,
      });
      return result;
    } finally {
      setIsPending(false);
    }
  }, [dappKit]);

  const mutate = useCallback((input: any, options?: any) => {
    mutateAsync(input)
      .then((result) => options?.onSuccess?.(result))
      .catch((err) => options?.onError?.(err));
  }, [mutateAsync]);

  return { mutate, mutateAsync, isPending };
}

export function useConnectWallet() {
  const dappKit = useDAppKit();
  const [isPending, setIsPending] = useState(false);

  const mutate = useCallback((input: any, options?: any) => {
    setIsPending(true);
    dappKit.connectWallet({ wallet: input.wallet })
      .then((result) => {
        setIsPending(false);
        options?.onSuccess?.(result);
        options?.onSettled?.(result, null);
      })
      .catch((err) => {
        setIsPending(false);
        options?.onError?.(err);
        options?.onSettled?.(null, err);
      });
  }, [dappKit]);

  const mutateAsync = useCallback(async (input: any) => {
    setIsPending(true);
    try {
      const result = await dappKit.connectWallet({ wallet: input.wallet });
      return result;
    } finally {
      setIsPending(false);
    }
  }, [dappKit]);

  return { mutate, mutateAsync, isPending };
}

export function useDisconnectWallet() {
  const dappKit = useDAppKit();
  const [isPending, setIsPending] = useState(false);

  const mutate = useCallback((_variables?: any, options?: any) => {
    if (_variables && typeof _variables === 'object' && ('onSuccess' in _variables || 'onError' in _variables || 'onSettled' in _variables)) {
      options = _variables;
    }
    setIsPending(true);
    dappKit.disconnectWallet()
      .then(() => {
        setIsPending(false);
        options?.onSuccess?.();
        options?.onSettled?.();
      })
      .catch((err) => {
        setIsPending(false);
        options?.onError?.(err);
        options?.onSettled?.();
      });
  }, [dappKit]);

  return { mutate, isPending };
}

export function useSuiClientQuery(
  method: string,
  params?: Record<string, any>,
  options?: { enabled?: boolean; refetchInterval?: number }
) {
  const client = _useCurrentClient() as any;
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

export function ConnectButton() {
  const account = _useCurrentAccount();
  const dappKit = useDAppKit();
  const wallets = _useWallets();
  const connection = useWalletConnection();
  const [showMenu, setShowMenu] = useState(false);

  if (account) {
    return (
      <button
        data-testid="button-disconnect-wallet"
        onClick={() => {
          dappKit.disconnectWallet();
          setShowMenu(false);
        }}
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
                dappKit.connectWallet({ wallet: w });
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
