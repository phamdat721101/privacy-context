/**
 * oapValidation — Content-Type-triggered typed envelope validation (PRD-U2).
 *
 * Behavior:
 *   • `Content-Type: application/oap+json` → validate body against
 *     `OapEnvelopeSchema` (Zod). On failure return 400 with the first typed
 *     issue path in `message`.
 *   • Any other Content-Type → pass through unchanged. Preserves byte-
 *     identical behavior for legacy string-prompt clients (per C2).
 *
 * On success the typed envelope is exposed at `req.oapEnvelope` so route
 * handlers see a fully-typed value without re-validating.
 *
 * Feature flag: gated by `FEATURE_TYPED_CONTEXT=true`. When off, the middleware
 * pass-throughs even for `application/oap+json` requests (they fall to legacy
 * handling exactly as before).
 *
 * SOLID:
 *   • SRP — one job: validate on the OAP MIME, otherwise get out of the way.
 *   • DIP — imports the Zod schema by name; no coupling to route bodies.
 */

import type { Request, Response, NextFunction } from 'express';
import { safeValidateEnvelope, type OapEnvelope } from '@fhe-ai-context/sdk';
import { isOpenxV2SubFlagOn } from '../lib';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      oapEnvelope?: OapEnvelope;
    }
  }
}

const OAP_MIME = 'application/oap+json';

export function oapValidation(req: Request, res: Response, next: NextFunction): void {
  // Pass-through unless feature flag on AND caller opted in via MIME type.
  if (!isOpenxV2SubFlagOn('FEATURE_TYPED_CONTEXT')) return next();

  const ct = (req.headers['content-type'] ?? '').toString().toLowerCase();
  if (!ct.startsWith(OAP_MIME)) return next();

  const result = safeValidateEnvelope(req.body);
  if ('reason' in result) {
    res.status(400).json({
      error: 'invalid_envelope',
      message: result.reason,
      // Include full issue list so callers can localize errors precisely.
      issues: result.issues.map((i) => ({
        path: i.path.join('.') || '(root)',
        code: i.code,
        message: i.message,
      })),
    });
    return;
  }

  req.oapEnvelope = result.value;
  next();
}
