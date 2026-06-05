/**
 * memwal/index.ts — public barrel for `@openx/memwal-adapter`.
 *
 * Single import surface for every consumer (api/, frontend/, worker/, scripts/).
 * Internal modules (rateLimitGuard, peer-dep loader) are intentionally NOT
 * re-exported — they are implementation details.
 */

export { OpenXMemWalAdapter } from './adapter';
// NOTE: `createFheEnvelope` + `cosineDistance` are NOT re-exported here.
// They live in `./fheEnvelope` which imports `node:crypto` (server-only).
// Server callers import them via the deep path:
//   `@fhe-ai-context/sdk/dist/memwal/fheEnvelope`
export {
  MEMWAL_NETWORKS,
  MEMWAL_RATE_CAPS,
  POINT_COSTS,
  type AdapterLogger,
  type AnalyzeResult,
  type FheEnvelope,
  type HealthSnapshot,
  type MemWalNetwork,
  type MemWalNetworkConfig,
  type MemWalOp,
  type MemWalOpName,
  type OpenXMemWalConfig,
  type PaymentGate,
  type PaymentGateResult,
  type RateLimitRedisLike,
  type RecallHit,
  type RecallResult,
  type RememberResult,
  type RestoreResult,
  type UsageSnapshot,
} from './types';
export {
  MemWalErrorCode,
  type MemWalErrorCodeT,
  OpenXMemWalAccountFrozenError,
  OpenXMemWalCompatibilityError,
  OpenXMemWalError,
  OpenXMemWalInvalidConfigError,
  OpenXMemWalNoAccessError,
  OpenXMemWalPaymentDeniedError,
  OpenXMemWalRateLimitError,
  OpenXMemWalStorageQuotaError,
  OpenXMemWalUpstreamMissingError,
} from './errors';
