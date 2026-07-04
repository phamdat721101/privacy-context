/**
 * Public barrel for the api's `lib/` directory.
 *
 * Server-coupled concerns stay here (logger, observability, lifecycle).
 * Runtime-neutral primitives (resilientCall, resumeToken) come from
 * `@fhe-ai-context/runtime-utils` so the SDK and any agent demos can reuse
 * the same code without an Express dependency.
 */

import {
  resilientCall as baseResilientCall,
  type ResilientOptions,
} from '@fhe-ai-context/runtime-utils';
import { logger } from './logger';

export { logger, correlationId, getRequestId, setRequestContext } from './logger';
export {
  metricsMiddleware,
  metricsHandler,
  healthHandler,
  registerHealthProbe,
  v2InferenceDurationMs,
  v2UploadsTotal,
  v2ChatsTotal,
  type HealthProbe,
  type DepStatus,
} from './observability';
export { installLifecycle } from './lifecycle';
export { verifyPrivyToken } from './privyAuth';

// Re-export runtime-utils primitives — single source of truth.
export {
  CircuitOpenError,
  getBreakerSnapshot,
  signResumeToken,
  verifyResumeToken,
  InvalidResumeToken,
  type ResilientOptions,
} from '@fhe-ai-context/runtime-utils';

/**
 * api-side `resilientCall` with the Pino logger pre-bound. Callers in routes
 * never have to pass a logger; correlation IDs propagate automatically through
 * the AsyncLocalStorage mixin in `logger.ts`.
 */
export function resilientCall<T>(
  opts: Omit<ResilientOptions, 'logger'> & { logger?: ResilientOptions['logger'] },
  fn: () => Promise<T>,
): Promise<T> {
  return baseResilientCall({ ...opts, logger: opts.logger ?? logger }, fn);
}

// ─── PRD-U feature-flag cascade ─────────────────────────────────────────
// Master flag `FEATURE_OPENX_V2=false` disables every sub-flag in one flip
// (ship-gate criterion 7). Otherwise the sub-flag is respected as-is. All
// v3-oap / v3-agents-v2 gate checks funnel through this helper so the
// cascade behavior is uniform + testable in one place.
export function isOpenxV2SubFlagOn(subFlag: string): boolean {
  if (process.env.FEATURE_OPENX_V2 === 'false') return false;
  return process.env[subFlag] === 'true';
}
