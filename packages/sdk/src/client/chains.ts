/**
 * Chain registry — Arbitrum-only after the v2.0 Sui-removal relaunch.
 * Single source of truth for RPC URLs.
 */

export const arbitrumSepolia = {
  id: 421614,
  name: 'Arbitrum Sepolia',
  rpcUrl:
    process.env.ARBITRUM_SEPOLIA_RPC ?? 'https://sepolia-rollup.arbitrum.io/rpc',
} as const;

export const arbitrum = {
  id: 42161,
  name: 'Arbitrum One',
  rpcUrl: process.env.ARBITRUM_RPC_URL ?? 'https://arb1.arbitrum.io/rpc',
} as const;

export type SupportedChain = typeof arbitrumSepolia | typeof arbitrum;
