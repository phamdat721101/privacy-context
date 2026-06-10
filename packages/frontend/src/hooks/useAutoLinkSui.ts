'use client';

/**
 * useAutoLinkSui — automatically POSTs to /v3/identity/link the first time the
 * user connects a Sui wallet *while* on a Sui network. Idempotent on the
 * server (ON CONFLICT DO UPDATE), and we de-dupe per session in-memory.
 *
 * Why a hook (SOLID):
 *  - SRP: just the side effect. UI layer (toast) is in the parent caller.
 *  - DIP: `signPersonalMessage` is the only Sui-specific dependency; if the
 *    user has no wallet, the hook is a no-op (no errors thrown).
 *  - OCP: replacing the canonical message format = changing one constant
 *    (mirrored in api/src/routes/v3-identity.ts).
 *
 * Replay defense: nonce + timestamp signed; server enforces 5-minute window.
 */

import { useEffect, useRef } from 'react';
import { useCurrentAccount, useSignPersonalMessage } from '@mysten/dapp-kit';
import { usePrivy } from '@privy-io/react-auth';
import { usePrivyEvmAddress } from './useActiveWallet';
import { useNetwork } from './useNetwork';
import { isSuiNetwork } from '@/lib/networks';
import { AGENT_BACKEND_URL } from '@/lib/contracts';

function canonicalMessage(evm: string, sui: string, nonce: string, ts: number): string {
  return `openx-link-sui:${evm.toLowerCase()}:${sui.toLowerCase()}:${nonce}:${ts}`;
}

export function useAutoLinkSui() {
  const { network } = useNetwork();
  const { authenticated, user } = usePrivy();
  // Privy's canonical address — works for embedded + external wallets.
  // (Earlier draft used `useWallets()[0]?.address` which is empty for
  // email-login users with embedded wallets only.)
  const evmAddress = usePrivyEvmAddress();
  const suiAccount = useCurrentAccount();
  const { mutateAsync: signMessage } = useSignPersonalMessage();

  // De-dupe per (evm, sui) pair within a session — avoids re-prompting on
  // every render or page navigation.
  const linkedPairs = useRef<Set<string>>(new Set());

  useEffect(() => {
    // Gate: must be on Sui mode + authenticated EVM-side + have a Sui account.
    if (!isSuiNetwork(network)) return;
    if (!authenticated || !evmAddress) return;
    if (!suiAccount) return;

    const pairKey = `${evmAddress.toLowerCase()}:${suiAccount.address.toLowerCase()}`;
    if (linkedPairs.current.has(pairKey)) return;
    linkedPairs.current.add(pairKey);

    void (async () => {
      try {
        const nonce = crypto.randomUUID();
        const ts = Date.now();
        const message = canonicalMessage(evmAddress, suiAccount.address, nonce, ts);
        const { signature } = await signMessage({ message: new TextEncoder().encode(message) });

        const res = await fetch(`${AGENT_BACKEND_URL}/v3/identity/link`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-wallet-address': evmAddress,
          },
          body: JSON.stringify({
            suiAddress: suiAccount.address,
            signature,
            nonce,
            ts,
          }),
        });
        if (!res.ok) {
          // Failure is non-fatal — the user can still browse; we just won't
          // have an EVM↔Sui binding row. Surface in console for diagnostics.
          // eslint-disable-next-line no-console
          console.warn('[openx] sui auto-link failed', await res.text().catch(() => ''));
          // Allow retry on next mount.
          linkedPairs.current.delete(pairKey);
        }
      } catch (err) {
        // User declined the signature, etc.
        // eslint-disable-next-line no-console
        console.info('[openx] sui auto-link skipped', (err as Error).message);
        linkedPairs.current.delete(pairKey);
      }
    })();
  }, [network, authenticated, evmAddress, suiAccount, signMessage]);
}
