// packages/sdk/src/constants.ts
//
// PRD-F: single source of truth for the agent auth header.
// Replaces 8 inline `'x-fhenix-permit'` literals across the SDK + API + docs.
//
// Semantics unchanged (Q2=a "rename only"): the agent sends a wallet-signed
// scoped onboard token; the server verifies it the same way and consumes
// the jti once. Only the header name moved.

/** HTTP header carrying the scoped onboard token from agent → API. */
export const AUTH_HEADER = 'x-openx-token';

/** Permit/token `name` scope prefix. The jti lives after the colon. */
export const TOKEN_SCOPE_PREFIX = 'openx-onboard:';

/** Default TTL for an onboard token (seconds). */
export const DEFAULT_TOKEN_TTL_SEC = 15 * 60;
