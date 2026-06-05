/**
 * Chain registry — single source of truth for RPC URLs across both tiers.
 *
 * Standard tier (Fhenix CoFHE) → Arbitrum Sepolia / Arbitrum One
 * Trustless tier (Walrus + SEAL + Phala TEE) → Sui testnet / Sui mainnet
 *
 * Trustless-tier RPC defaults to Tatum Gateway (per Tatum × Walrus hackathon
 * judging requirement); override with `SUI_RPC_URL` if running direct or
 * against a self-hosted node. Tatum API key flows through the `x-api-key`
 * header — wire it into the SuiClient transport.
 */

export const arbitrumSepolia = {
  id: 421614,
  name: 'Arbitrum Sepolia',
  rpcUrl: 'https://sepolia-rollup.arbitrum.io/rpc',
} as const;

export const arbitrum = {
  id: 42161,
  name: 'Arbitrum One',
  rpcUrl: 'https://arb1.arbitrum.io/rpc',
} as const;

/** Sui testnet — Tatum Gateway by default; falls back to public fullnode. */
export const suiTestnet = {
  id: 'sui-testnet',
  name: 'Sui Testnet',
  rpcUrl:
    process.env.SUI_TESTNET_RPC_URL ??
    'https://sui-testnet.gateway.tatum.io',
  /** Walrus testnet aggregator/publisher. */
  walrusPublisherUrl:
    process.env.WALRUS_TESTNET_PUBLISHER_URL ??
    'https://publisher.walrus-testnet.walrus.space',
  walrusAggregatorUrl:
    process.env.WALRUS_TESTNET_AGGREGATOR_URL ??
    'https://aggregator.walrus-testnet.walrus.space',
} as const;

/** Sui mainnet — Tatum Gateway by default. */
export const suiMainnet = {
  id: 'sui-mainnet',
  name: 'Sui Mainnet',
  rpcUrl:
    process.env.SUI_RPC_URL ??
    'https://sui-mainnet.gateway.tatum.io',
  walrusPublisherUrl:
    process.env.WALRUS_PUBLISHER_URL ??
    'https://publisher.walrus.space',
  walrusAggregatorUrl:
    process.env.WALRUS_AGGREGATOR_URL ??
    'https://aggregator.walrus.space',
} as const;

export type SupportedChain = typeof arbitrumSepolia | typeof arbitrum;
export type SuiNetwork = typeof suiTestnet | typeof suiMainnet;

/**
 * Optional headers applied to Tatum-routed Sui RPC calls.
 * Returns `{}` when `TATUM_API_KEY` is unset (so direct fullnode URLs work).
 */
export function suiRpcHeaders(): Record<string, string> {
  const key = process.env.TATUM_API_KEY;
  return key ? { 'x-api-key': key } : {};
}
