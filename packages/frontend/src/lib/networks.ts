/**
 * lib/networks.ts — single source of truth for the networks OpenX supports:
 * Base Sepolia (USDC payments) and Arbitrum Sepolia (FHE brain tier on
 * Fhenix CoFHE).
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
 *  - DRY: chain primitives come from `wagmi/chains`. RPC URLs, native
 *    currency, and explorer URLs are *never* duplicated here.
 *  - OCP: adding a new network = appending one entry to `SUPPORTED_NETWORKS`
 *    plus, if the wallet doesn't auto-recognise it, an `addChainPayload`.
 */

import { arbitrumSepolia, baseSepolia } from 'wagmi/chains';

// ─── Public chain-id constants — imported by hooks/pages ─────────────────

export const BASE_SEPOLIA_CHAIN_ID = baseSepolia.id;
export const ARBITRUM_SEPOLIA_CHAIN_ID = arbitrumSepolia.id;

// ─── Stablecoin addresses ────────────────────────────────────────────────

/** Circle's official USDC on Arbitrum Sepolia (https://developers.circle.com/stablecoins/docs/usdc-on-test-networks) */
export const CIRCLE_USDC_ADDRESS_ARB_SEP =
  (process.env.NEXT_PUBLIC_CIRCLE_USDC_ADDRESS ?? '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d') as `0x${string}`;

/** WrappedStablecoin (FHE-encrypted balance over Circle USDC). Set after deploy. */
export const WRAPPED_USDC_ADDRESS =
  (process.env.NEXT_PUBLIC_WRAPPED_USDC_ADDRESS ?? '') as `0x${string}`;

/** PrivPayGateway — used for confidential-amount escrow flows. */
export const PRIV_PAY_GATEWAY_ADDRESS =
  (process.env.NEXT_PUBLIC_PRIV_PAY_GATEWAY_ADDRESS ?? '') as `0x${string}`;

/** Circle faucet URL for Arbitrum-Sepolia testnet USDC. */
export const CIRCLE_FAUCET_URL = 'https://faucet.circle.com/';

// ─── Types ───────────────────────────────────────────────────────────────

export type NetworkKey = 'base-sepolia' | 'arbitrum-sepolia';

/** Which OpenX feature primarily uses a given chain. Surfaced in the UI
 *  so the user understands *why* they'd switch. */
export type NetworkFeature = 'payment' | 'fhe-brain';

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
   * EIP-3085 `wallet_addEthereumChain` payload. Only set for chains unlikely
   * to be pre-known by user wallets. Both chains here are bundled into
   * MetaMask & most embedded wallets, so a plain `wallet_switchEthereumChain`
   * is enough — no payload is needed today.
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
