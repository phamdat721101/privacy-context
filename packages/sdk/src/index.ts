export * from './client/chains';
export * from './client/cofheClient';
export * from './context/contextTypes';
export * from './context/encryptContext';
export * from './context/decryptContext';
// Cognitive Memory v1 (L1/L2/L3 — Fhenix-encrypted, Postgres-backed)
// keyWrap.ts is intentionally NOT re-exported here — it imports node:crypto
// and is server-only. Server code imports it via the deep path
// '@fhe-ai-context/sdk/cognitive/keyWrap' (or relative path); the frontend
// never needs it (decryption happens server-side under owner auth).
export * from './cognitive/types';
export * from './cognitive/consolidator';
// Cognitive ↔ MemWal namespace formatter (PRD-10). Single source of truth
// for the `cog-l{N}-{brainId}[-{sessionId}]` string convention used by both
// the dual-write path and the marketplace publish flow.
export * from './cognitive/namespaces';
export * from './permits/createPermit';
export * from './permits/importPermit';
export * from './permits/revokePermit';
export * from './utils/hashMemory';
export * from './utils/encodeSentiment';
export * from './skill/skillTypes';
export * from './skill/encryptSkill';
export * from './skill/decryptSkill';
export * from './payment/paymentTypes';
export * from './payment/encryptPayment';
export * from './payment/decryptPayment';
export * from './payment/payRouter';
export * from './payment/fherc20Adapter';
export * from './bundle/BundleRunner';
export * from './billing/billingTypes';
export * from './billing/encryptBilling';
export * from './privacy/index';
export * from './manifest/index';
export * from './brain/types';
export * from './brain/client';
export * from './brain/encryption';
export * from './brain/migrate';
export * from './agent/kyaClient';
// OpenX 4-verb facade (verbatim MemWal verbs) — public entry point.
export * from './openx';
// Walrus Memory bridge (Day-30 deliverable). Tier-guarded + optional peer-dep.
export * from './walrusMemoryBridge';
// MemWal adapter (PRD-06) — the single supported way OpenX talks to MemWal.
// Layered above walrusMemoryBridge; mirror-deprecates it once consumers migrate.
// Renamed types avoid collisions with the openx.ts facade (RecallResult, etc.).
export {
  OpenXMemWalAdapter,
  MEMWAL_NETWORKS,
  MEMWAL_RATE_CAPS,
  POINT_COSTS,
  MemWalErrorCode,
  OpenXMemWalAccountFrozenError,
  OpenXMemWalCompatibilityError,
  OpenXMemWalError,
  OpenXMemWalInvalidConfigError,
  OpenXMemWalNoAccessError,
  OpenXMemWalPaymentDeniedError,
  OpenXMemWalRateLimitError,
  OpenXMemWalStorageQuotaError,
  OpenXMemWalUpstreamMissingError,
  // NOTE: `createFheEnvelope` + `cosineDistance` are intentionally NOT
  // re-exported here — they live in `memwal/fheEnvelope.ts` which imports
  // `node:crypto` and is server-only (same constraint as `cognitive/keyWrap`).
  // Server code imports them via the deep path `@fhe-ai-context/sdk/dist/memwal/fheEnvelope`.
  type AdapterLogger as MemWalAdapterLogger,
  type AnalyzeResult as MemWalAnalyzeResult,
  type FheEnvelope as MemWalFheEnvelope,
  type HealthSnapshot as MemWalHealthSnapshot,
  type MemWalNetwork,
  type MemWalNetworkConfig,
  type MemWalOp,
  type MemWalOpName,
  type OpenXMemWalConfig,
  type PaymentGate as MemWalPaymentGate,
  type PaymentGateResult as MemWalPaymentGateResult,
  type RateLimitRedisLike,
  type RecallHit as MemWalRecallHit,
  type RecallResult as MemWalRecallResult,
  type RememberResult as MemWalRememberResult,
  type RestoreResult as MemWalRestoreResult,
  type UsageSnapshot as MemWalUsageSnapshot,
} from './memwal';
// MCP server (JSON-RPC 2.0 dispatch) — re-exported from `mcp/server.ts`.
export * from './mcp/server';
export * from './mcp/tools';
