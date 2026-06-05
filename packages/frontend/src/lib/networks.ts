/**
 * lib/networks.ts — single source of truth for the networks OpenX supports:
 * Base Sepolia (USDC payments), Arbitrum Sepolia (FHE brain tier on Fhenix
 * CoFHE), and Sui Testnet (Trustless tier — Walrus + SEAL + Tatum).
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

export type NetworkKey = 'base-sepolia' | 'arbitrum-sepolia' | 'sui-testnet';

/** EVM chains use `wallet.switchChain(id)`; Sui chains use the dapp-kit
 *  ConnectModal flow. The `kind` discriminator lets `NetworkSwitcher`
 *  branch without leaking chain-family details into UI code. */
export type NetworkKind = 'evm' | 'sui';

/** Which OpenX feature primarily uses a given chain. Surfaced in the UI
 *  so the user understands *why* they'd switch. */
export type NetworkFeature = 'payment' | 'fhe-brain' | 'trustless';

/** Storage tier this network drives. Single source of truth for `useTier`. */
export type NetworkTier = 'standard' | 'trustless';

interface BaseNetwork {
  readonly key: NetworkKey;
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
  readonly tier: NetworkTier;
}

export interface EvmNetwork extends BaseNetwork {
  readonly kind: 'evm';
  /** Decimal EVM chain id — required by `wallet.switchChain`. */
  readonly id: number;
  readonly nativeCurrency: { name: string; symbol: string; decimals: number };
  /**
   * EIP-3085 `wallet_addEthereumChain` payload. Only set for chains unlikely
   * to be pre-known by user wallets. Both EVM chains here are bundled into
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

export interface SuiNetwork extends BaseNetwork {
  readonly kind: 'sui';
  /** Sui chain identifier — `sui:testnet` | `sui:mainnet`. */
  readonly suiChain: 'sui:testnet' | 'sui:mainnet' | 'sui:devnet';
}

export type Network = EvmNetwork | SuiNetwork;

// ─── Registry ────────────────────────────────────────────────────────────

export const SUPPORTED_NETWORKS: readonly Network[] = [
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
  {
    key: 'arbitrum-sepolia',
    kind: 'evm',
    id: ARBITRUM_SEPOLIA_CHAIN_ID,
    name: 'Arbitrum Sepolia',
    shortName: 'Arbitrum',
    icon: '🔷',
    feature: 'fhe-brain',
    featureHint: 'FHE brain & subscriptions',
    tier: 'standard',
    rpcUrl: arbitrumSepolia.rpcUrls.default.http[0],
    blockExplorer: arbitrumSepolia.blockExplorers.default.url,
    nativeCurrency: arbitrumSepolia.nativeCurrency,
  },
  {
    key: 'sui-testnet',
    kind: 'sui',
    suiChain: 'sui:testnet',
    name: 'Sui Testnet',
    shortName: 'Sui',
    icon: '🟣',
    feature: 'trustless',
    featureHint: 'Walrus + SEAL + Tatum (trustless)',
    tier: 'trustless',
    rpcUrl: 'https://fullnode.testnet.sui.io',
    blockExplorer: 'https://suiscan.xyz/testnet',
  },
] as const;

// ─── Lookups ─────────────────────────────────────────────────────────────

export function getNetworkById(id: number | undefined | null): Network | undefined {
  if (id == null) return undefined;
  return SUPPORTED_NETWORKS.find((n) => n.kind === 'evm' && n.id === id);
}

export function getNetworkByKey(key: NetworkKey): Network {
  // SUPPORTED_NETWORKS is a static const tuple — every NetworkKey is guaranteed
  // to resolve. Non-null assertion is safe and keeps the call-site type clean.
  return SUPPORTED_NETWORKS.find((n) => n.key === key)!;
}

export function isSupportedChainId(id: number | undefined | null): boolean {
  return getNetworkById(id) !== undefined;
}

/** True when the network is an EVM chain — narrows to {@link EvmNetwork}. */
export function isEvmNetwork(n: Network | undefined | null): n is EvmNetwork {
  return !!n && n.kind === 'evm';
}

/** True when the network is a Sui chain — narrows to {@link SuiNetwork}. */
export function isSuiNetwork(n: Network | undefined | null): n is SuiNetwork {
  return !!n && n.kind === 'sui';
}

/**
 * Chain-aware wallet-address validator.
 *
 * EVM addresses are 20 bytes (`0x` + 40 hex). Sui addresses are 32 bytes
 * (`0x` + 64 hex). viem's `isAddress` is strictly EVM-only — it returns
 * false for Sui addresses, which breaks any input that lets sellers paste
 * their pay-to wallet (PublishWizard, settlement config, etc.).
 *
 * Use this helper in any UI field that accepts a wallet address and needs
 * to work on both tiers. On EVM it accepts checksummed or lowercase EVM;
 * on Sui it accepts the 32-byte hex form. SOLID: one helper, both rules.
 */
export function isValidWalletAddress(addr: string, chain: 'sui' | 'evm'): boolean {
  if (typeof addr !== 'string') return false;
  if (chain === 'sui') return /^0x[0-9a-fA-F]{64}$/.test(addr);
  return /^0x[0-9a-fA-F]{40}$/.test(addr);
}

/**
 * Chain-agnostic wallet-address validator. Accepts either EVM (40 hex)
 * or Sui (64 hex) format. Use in surfaces that don't know the chain at
 * validation time (e.g. PublishWizard's pay-to field — chain is set
 * later in the same form).
 */
export function isValidEvmOrSuiAddress(addr: string): boolean {
  return isValidWalletAddress(addr, 'evm') || isValidWalletAddress(addr, 'sui');
}
