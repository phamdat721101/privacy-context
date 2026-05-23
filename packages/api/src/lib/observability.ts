import type { Request, Response, RequestHandler } from 'express';
import client from 'prom-client';
import { getBreakerSnapshot } from '@fhe-ai-context/runtime-utils';
import { logger } from './logger';

/**
 * Observability — `/metrics` (Prometheus) + `/health` (dependency probes).
 *
 * SOLID:
 * - Single Responsibility: this file owns the *outward-facing* observability
 *   endpoints. The mechanics of *why* a dep is unhealthy live in `resilientCall`.
 * - Open/Closed: dependency probes are registered via `registerHealthProbe`,
 *   never by editing this file.
 * - Liskov: every probe satisfies the same `HealthProbe` contract.
 */

const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry });

export const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'path', 'status'] as const,
  registers: [registry],
});

export const httpRequestDurationMs = new client.Histogram({
  name: 'http_request_duration_ms',
  help: 'HTTP request duration in milliseconds',
  labelNames: ['method', 'path', 'status'] as const,
  buckets: [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
  registers: [registry],
});

// v2 privacy pipeline metrics
export const v2InferenceDurationMs = new client.Histogram({
  name: 'v2_inference_duration_ms',
  help: 'v2 inference call duration',
  buckets: [100, 500, 1000, 3000, 5000, 10000, 30000],
  registers: [registry],
});

export const v2UploadsTotal = new client.Counter({
  name: 'v2_uploads_total',
  help: 'Total v2 opaque uploads',
  registers: [registry],
});

export const v2ChatsTotal = new client.Counter({
  name: 'v2_chats_total',
  help: 'Total v2 chat inferences',
  registers: [registry],
});

// v3 agentic-marketplace metrics
export const v3RailReceiptsTotal = new client.Counter({
  name: 'v3_rail_receipts_total',
  help: 'Total v3 paid agent calls per rail',
  labelNames: ['rail'] as const,
  registers: [registry],
});

export const v3PayLatencyMs = new client.Histogram({
  name: 'v3_pay_latency_ms',
  help: 'PayRouter rail dispatch latency',
  labelNames: ['rail'] as const,
  buckets: [10, 50, 100, 250, 500, 1000, 2500, 5000],
  registers: [registry],
});

export const v3BundleStepsTotal = new client.Counter({
  name: 'v3_bundle_steps_total',
  help: 'Total bundle steps executed (hosted runner)',
  labelNames: ['outcome'] as const,
  registers: [registry],
});

/** Express middleware that records request count + duration. Mount once, near the top. */
export function metricsMiddleware(): RequestHandler {
  return (req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const labels = { method: req.method, path: req.route?.path ?? req.path, status: String(res.statusCode) };
      httpRequestsTotal.inc(labels);
      httpRequestDurationMs.observe(labels, Date.now() - start);
    });
    next();
  };
}

/** Mounts as a route handler at `/metrics`. */
export const metricsHandler: RequestHandler = async (_req, res) => {
  res.setHeader('Content-Type', registry.contentType);
  res.send(await registry.metrics());
};

// ---------- Health ----------------------------------------------------------

export type DepStatus = 'ok' | 'degraded' | 'down';

export interface HealthProbe {
  name: string;
  /** Returns `ok` quickly (≤1s). Throw to signal `down`. */
  check: () => Promise<DepStatus>;
}

const probes: HealthProbe[] = [];

/** Add a probe that the `/health` endpoint will run on every hit. */
export function registerHealthProbe(probe: HealthProbe): void {
  probes.push(probe);
}

/** Single-shot probe with a 1s timeout. Probe internals never block the response. */
async function runProbe(probe: HealthProbe): Promise<DepStatus> {
  try {
    const result = await Promise.race<DepStatus>([
      probe.check(),
      new Promise<DepStatus>((_, reject) => setTimeout(() => reject(new Error('probe timeout')), 1_000)),
    ]);
    return result;
  } catch (err) {
    logger.warn({ dep: probe.name, err: (err as Error)?.message }, 'health:probe_failed');
    return 'down';
  }
}

export const healthHandler: RequestHandler = async (_req: Request, res: Response) => {
  const deps: Record<string, DepStatus> = {};
  // Aggregate breaker state into the health view: an OPEN breaker is `degraded`
  // even if the live probe currently passes — clients should know the server is
  // shedding load.
  const breakers = getBreakerSnapshot();
  for (const [name, b] of Object.entries(breakers)) {
    deps[name] = b.state === 'OPEN' ? 'degraded' : 'ok';
  }

  await Promise.all(
    probes.map(async (p) => {
      const status = await runProbe(p);
      // Worst status wins.
      if (deps[p.name] !== 'down') deps[p.name] = status;
    }),
  );

  const overall: DepStatus = Object.values(deps).reduce<DepStatus>(
    (worst, current) => (current === 'down' ? 'down' : current === 'degraded' ? (worst === 'down' ? 'down' : 'degraded') : worst),
    'ok',
  );

  res.status(overall === 'down' ? 503 : 200).json({ status: overall, deps });
};
