'use client';

/**
 * lib/arkivBrowserClient.ts — Privy ↔ Arkiv browser-side wallet adapter.
 *
 * Single boundary between Privy's EIP-1193 provider and Arkiv's wallet client.
 * Every component that needs to *write* an entity (sign + send) calls
 * getArkivWalletClient(). Reads still go through getArkivPublicClient() in
 * lib/arkiv.ts (no signing required, browser-safe).
 *
 * Chain-onboarding strategy (EIP-3326 + EIP-3085 canonical pattern):
 *   1. wallet_switchEthereumChain  → silent if already on Braga; ~zero UX cost.
 *   2. on code 4902 (chain not added) → wallet_addEthereumChain (one prompt).
 *   3. on code 4001 (user rejected) → throw a typed error the UI can render.
 *
 * SOLID:
 * - SRP: one concern — turning a Privy wallet into an Arkiv wallet client.
 * - DIP: callers depend on getArkivWalletClient(), never on Privy/Arkiv directly.
 * - DRY: every chain field comes from `braga` exported by @arkiv-network/sdk —
 *   we never duplicate id, rpc, native-currency, or explorer URLs in code.
 */

import { createWalletClient, custom } from '@arkiv-network/sdk';
import { braga } from '@arkiv-network/sdk/chains';
import type { ConnectedWallet } from '@privy-io/react-auth';
import type { Hex } from 'viem';

/** Hex form of braga.id (60138453102 → 0xE0087F86E). Computed once. */
const BRAGA_HEX: Hex = `0x${braga.id.toString(16)}` as Hex;

type Eip1193 = { request: (args: { method: string; params?: unknown }) => Promise<unknown> };

export const ARKIV_BRAGA_FAUCET = 'https://braga.hoodi.arkiv.network/faucet/';

/**
 * Build an Arkiv walletClient that signs through the user's Privy wallet.
 * Idempotently ensures the wallet is on Braga (silent if it already is).
 *
 * @throws when the wallet rejects the chain switch/add or no provider exists.
 */
export async function getArkivWalletClient(privyWallet: ConnectedWallet) {
  if (!privyWallet) throw new Error('No Privy wallet connected');
  const provider = (await privyWallet.getEthereumProvider()) as unknown as Eip1193 | null;
  if (!provider) throw new Error('Privy wallet has no EIP-1193 provider');

  await ensureBragaSelected(provider);

  return createWalletClient({
    chain: braga,
    transport: custom(provider as unknown as Parameters<typeof custom>[0]),
    account: privyWallet.address as Hex,
  });
}

/**
 * Ensures the wallet is on Braga.
 *  - switch first (no prompt if already on Braga)
 *  - on 4902, fall through to add (single prompt)
 *  - on 4001 (any rejection), throw a typed marker error for the UI
 *
 * Exported so the top-bar `NetworkSwitcher` can reuse the same logic when
 * the user picks "Arkiv Braga" from the dropdown — keeping a single source
 * of truth for the canonical 4902 → addEthereumChain fallback.
 */
export async function ensureBragaSelected(provider: Eip1193): Promise<void> {
  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: BRAGA_HEX }],
    });
    return;
  } catch (err) {
    const e = err as { code?: number };
    // 4902 = chain unknown → add it
    if (e.code === 4902 || /unrecognized|not.*added/i.test((err as Error).message ?? '')) {
      try {
        await provider.request({
          method: 'wallet_addEthereumChain',
          params: [
            {
              chainId: BRAGA_HEX,
              chainName: braga.name,
              rpcUrls: [...braga.rpcUrls.default.http],
              nativeCurrency: braga.nativeCurrency,
              blockExplorerUrls: [braga.blockExplorers.default.url],
            },
          ],
        });
        return;
      } catch (addErr) {
        const ae = addErr as { code?: number };
        if (ae.code === 4001) throw new Error('user-rejected-chain-add');
        throw addErr;
      }
    }
    if (e.code === 4001) throw new Error('user-rejected-chain-switch');
    throw err;
  }
}
