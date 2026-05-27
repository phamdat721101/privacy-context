/**
 * lib/networks.ts — single source of truth for the three networks Fhedin
 * supports today: Base Sepolia (USDC payments), Arbitrum Sepolia (FHE brain
 * tier on Fhenix CoFHE), and Arkiv Braga (Memory tier).
 *
 * Why this file exists
 * --------------------
 * Before this module landed, chain ids leaked into seven places: each hook
 * (`usePayments`, `useSkillMarketplace`, `useAgentBilling`, `usePermit`),
 * the `/chat/[agentId]` page, and the wagmi config. Any of those could
 * drift independently. This file makes the registry the *only* place where
 * a chain id can be typed by hand — every other module must import a named
 * constant or call a lookup function.
 *
 * SOLID
 * -----
 *  - SRP: metadata + lookups only. No React, no wallet calls, no fetches.
 *  - DRY: chain primitives come from `wagmi/chains` (Base / Arbitrum) and
 *    `@arkiv-network/sdk/chains` (Braga). RPC URLs, native currency, and
 *    explorer URLs are *never* duplicated here.
 *  - OCP: adding a fourth network = appending one entry to `SUPPORTED_NETWORKS`
 *    plus, if the wallet doesn't auto-recognise it, an `addChainPayload`.
 */

import { arbitrumSepolia, baseSepolia } from 'wagmi/chains';
import { braga } from '@arkiv-network/sdk/chains';

// ─── Public chain-id constants — imported by hooks/pages ─────────────────

export const BASE_SEPOLIA_CHAIN_ID = baseSepolia.id;
export const ARBITRUM_SEPOLIA_CHAIN_ID = arbitrumSepolia.id;
export const ARKIV_BRAGA_CHAIN_ID = braga.id;

// ─── Types ───────────────────────────────────────────────────────────────

export type NetworkKey = 'base-sepolia' | 'arbitrum-sepolia' | 'arkiv-braga';

/** Which Fhedin feature primarily uses a given chain. Surfaced in the UI
 *  so the user understands *why* they'd switch. */
export type NetworkFeature = 'payment' | 'fhe-brain' | 'memory';

export interface Network {
  readonly key: NetworkKey;
  readonly id: number;
  /** Long display name — used in the dropdown row. */
  readonly name: string;
  /** Short pill label — used in the collapsed header pill. */
  readonly shortName: string;
  /** Single-glyph emoji prefix; cheap, SSR-safe, no extra asset bytes. */
  readonly icon: string;
  readonly feature: NetworkFeature;
  readonly featureHint: string;
  readonly rpcUrl: string;
  readonly blockExplorer: string;
  readonly nativeCurrency: { name: string; symbol: string; decimals: number };
  /**
   * EIP-3085 `wallet_addEthereumChain` payload. Only present when the chain
   * is unlikely to be pre-known by user wallets — Arkiv-Braga today.
   * Base/Arbitrum Sepolia are bundled in MetaMask & most embedded wallets,
   * so a plain `wallet_switchEthereumChain` is enough for them.
   */
  readonly addChainPayload?: {
    chainId: `0x${string}`;
    chainName: string;
    rpcUrls: string[];
    nativeCurrency: { name: string; symbol: string; decimals: number };
    blockExplorerUrls: string[];
  };
}

// ─── Registry ────────────────────────────────────────────────────────────

export const SUPPORTED_NETWORKS: readonly Network[] = [
  {
    key: 'base-sepolia',
    id: BASE_SEPOLIA_CHAIN_ID,
    name: 'Base Sepolia',
    shortName: 'Base',
    icon: '🔵',
    feature: 'payment',
    featureHint: 'USDC payments (x402)',
    rpcUrl: baseSepolia.rpcUrls.default.http[0],
    blockExplorer: baseSepolia.blockExplorers.default.url,
    nativeCurrency: baseSepolia.nativeCurrency,
  },
  {
    key: 'arbitrum-sepolia',
    id: ARBITRUM_SEPOLIA_CHAIN_ID,
    name: 'Arbitrum Sepolia',
    shortName: 'Arbitrum',
    icon: '🔷',
    feature: 'fhe-brain',
    featureHint: 'FHE brain & subscriptions',
    rpcUrl: arbitrumSepolia.rpcUrls.default.http[0],
    blockExplorer: arbitrumSepolia.blockExplorers.default.url,
    nativeCurrency: arbitrumSepolia.nativeCurrency,
  },
  {
    key: 'arkiv-braga',
    id: ARKIV_BRAGA_CHAIN_ID,
    name: 'Arkiv Braga (Golem)',
    shortName: 'Arkiv',
    icon: '🟢',
    feature: 'memory',
    featureHint: 'Wallet-owned memory',
    rpcUrl: braga.rpcUrls.default.http[0],
    blockExplorer: braga.blockExplorers.default.url,
    nativeCurrency: braga.nativeCurrency,
    addChainPayload: {
      chainId: `0x${braga.id.toString(16)}` as `0x${string}`,
      chainName: braga.name,
      rpcUrls: [...braga.rpcUrls.default.http],
      nativeCurrency: braga.nativeCurrency,
      blockExplorerUrls: [braga.blockExplorers.default.url],
    },
  },
] as const;

// ─── Lookups ─────────────────────────────────────────────────────────────

export function getNetworkById(id: number | undefined | null): Network | undefined {
  if (id == null) return undefined;
  return SUPPORTED_NETWORKS.find((n) => n.id === id);
}

export function getNetworkByKey(key: NetworkKey): Network {
  // SUPPORTED_NETWORKS is a static const tuple — every NetworkKey is guaranteed
  // to resolve. Non-null assertion is safe and keeps the call-site type clean.
  return SUPPORTED_NETWORKS.find((n) => n.key === key)!;
}

export function isSupportedChainId(id: number | undefined | null): boolean {
  return getNetworkById(id) !== undefined;
}
