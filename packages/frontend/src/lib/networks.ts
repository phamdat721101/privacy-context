/**
 * lib/networks.ts — Arbitrum-only registry post-Sui-removal.
 *
 * SOLID:
 *   - SRP: chain metadata + lookups only. No React, no wallet calls.
 *   - DRY: chain primitives come from `wagmi/chains`.
 *
 * Public chain-id constants stay so existing hook imports don't break.
 */

import { arbitrumSepolia, baseSepolia } from 'wagmi/chains';

export const BASE_SEPOLIA_CHAIN_ID = baseSepolia.id;
export const ARBITRUM_SEPOLIA_CHAIN_ID = arbitrumSepolia.id;

/** Circle's official USDC on Arbitrum Sepolia. */
export const CIRCLE_USDC_ADDRESS_ARB_SEP =
  (process.env.NEXT_PUBLIC_CIRCLE_USDC_ADDRESS ??
    '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d') as `0x${string}`;

/** WrappedStablecoin (FHE-encrypted balance over Circle USDC). Set after deploy. */
export const WRAPPED_USDC_ADDRESS =
  (process.env.NEXT_PUBLIC_WRAPPED_USDC_ADDRESS ?? '') as `0x${string}`;

/** PrivPayGateway — used for confidential-amount escrow flows. */
export const PRIV_PAY_GATEWAY_ADDRESS =
  (process.env.NEXT_PUBLIC_PRIV_PAY_GATEWAY_ADDRESS ?? '') as `0x${string}`;

/** Circle faucet URL for Arbitrum-Sepolia testnet USDC. */
export const CIRCLE_FAUCET_URL = 'https://faucet.circle.com/';

export type NetworkKey = 'arbitrum-sepolia' | 'base-sepolia';
export type NetworkKind = 'evm';
export type NetworkFeature = 'payment' | 'fhe-brain';
export type NetworkTier = 'standard';

export interface EvmNetwork {
  readonly key: NetworkKey;
  readonly kind: NetworkKind;
  readonly id: number;
  readonly name: string;
  readonly shortName: string;
  readonly icon: string;
  readonly feature: NetworkFeature;
  readonly featureHint: string;
  readonly tier: NetworkTier;
  readonly rpcUrl: string;
  readonly blockExplorer: string;
  readonly nativeCurrency: { name: string; symbol: string; decimals: number };
}

export type Network = EvmNetwork;

export const SUPPORTED_NETWORKS: readonly Network[] = [
  {
    key: 'arbitrum-sepolia',
    kind: 'evm',
    id: ARBITRUM_SEPOLIA_CHAIN_ID,
    name: 'Arbitrum Sepolia',
    shortName: 'Arbitrum',
    icon: '🔷',
    feature: 'fhe-brain',
    featureHint: 'Encrypted brain & subscriptions',
    tier: 'standard',
    rpcUrl: arbitrumSepolia.rpcUrls.default.http[0],
    blockExplorer: arbitrumSepolia.blockExplorers.default.url,
    nativeCurrency: arbitrumSepolia.nativeCurrency,
  },
  {
    key: 'base-sepolia',
    kind: 'evm',
    id: BASE_SEPOLIA_CHAIN_ID,
    name: 'Base Sepolia',
    shortName: 'Base',
    icon: '🔵',
    feature: 'payment',
    featureHint: 'USDC payments (x402)',
    tier: 'standard',
    rpcUrl: baseSepolia.rpcUrls.default.http[0],
    blockExplorer: baseSepolia.blockExplorers.default.url,
    nativeCurrency: baseSepolia.nativeCurrency,
  },
] as const;

export function getNetworkById(id: number | undefined | null): Network | undefined {
  if (id == null) return undefined;
  return SUPPORTED_NETWORKS.find((n) => n.id === id);
}

export function getNetworkByKey(key: NetworkKey): Network {
  return SUPPORTED_NETWORKS.find((n) => n.key === key) ?? SUPPORTED_NETWORKS[0];
}

export function isSupportedChainId(id: number | undefined | null): boolean {
  return getNetworkById(id) !== undefined;
}

/** True when the network is an EVM chain — narrows to {@link EvmNetwork}. */
export function isEvmNetwork(n: Network | undefined | null): n is EvmNetwork {
  return !!n && n.kind === 'evm';
}

/** Validate an EVM wallet address (40-hex). */
export function isValidWalletAddress(addr: string): boolean {
  return typeof addr === 'string' && /^0x[0-9a-fA-F]{40}$/.test(addr);
}
