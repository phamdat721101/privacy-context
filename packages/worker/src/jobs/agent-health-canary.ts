/**
 * agent-health-canary — periodic health probe for kind='public' agents.
 *
 * Runs every CANARY_INTERVAL_MS (default 1 h). Probes each agent's
 * endpoint_url with POST /openx/health { nonce }. Updates verification_status
 * based on consecutive failures: 3+ → degraded, 24+ → dormant.
 *
 * SOLID:
 *   • SRP — one job: health-check the public-agent fleet.
 *   • DIP — uses the same shape as conciergeOnboardService.probeEndpoint();
 *           a refactor to share that helper is fine but not required.
 */

import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import pg from 'pg';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('supabase') ? { rejectUnauthorized: false } : undefined,
});

const CANARY_INTERVAL_MS = Math.max(5_000, Number(process.env.OPENX_CANARY_INTERVAL_MS ?? 3_600_000));
const PROBE_TIMEOUT_MS = Math.max(1_000, Number(process.env.OPENX_HEALTH_PROBE_TIMEOUT_MS ?? 3_000));
const BATCH_SIZE = Math.max(1, Number(process.env.OPENX_CANARY_BATCH ?? 200));
const SERVICE_KEY_ID = process.env.OPENX_SERVICE_KEY_ID ?? 'svc-dev';

const DEGRADED_THRESHOLD = 3;
const DORMANT_THRESHOLD = 24;

interface AgentRow {
  id: string;
  slug: string;
  endpoint_url: string;
  verification_status: 'unverified' | 'verified' | 'degraded' | 'dormant';
  consecutive_health_fails: number;
}

async function probeOnce(url: string): Promise<{ ok: boolean; reason?: string }> {
  if (!isSafeUrl(url)) return { ok: false, reason: 'unsafe_url' };
  const nonce = randomBytes(16).toString('hex');
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url.replace(/\/$/, '') + '/openx/health', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-openx-service-key-id': SERVICE_KEY_ID },
      body: JSON.stringify({ nonce, timestamp: Date.now() }),
      signal: ac.signal,
    });
    if (!res.ok) return { ok: false, reason: `status_${res.status}` };
    const body = (await res.json().catch(() => ({}))) as { nonce_echo?: string };
    if (body.nonce_echo !== nonce) return { ok: false, reason: 'nonce_mismatch' };
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: (err as Error).name === 'AbortError' ? 'timeout' : 'network_error' };
  } finally {
    clearTimeout(timer);
  }
}

function isSafeUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    if (process.env.ALLOW_PRIVATE_ENDPOINTS === '1') return true;
    const host = u.hostname.toLowerCase();
    if (['localhost', '0.0.0.0', '::1'].includes(host)) return false;
    if (host.endsWith('.internal') || host.endsWith('.local')) return false;
    if (/^127\.|^10\.|^192\.168\.|^169\.254\./.test(host)) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
    return true;
  } catch {
    return false;
  }
}

async function runOnce(): Promise<{ checked: number; ok: number; fail: number }> {
  const r = await pool.query<AgentRow>(
    `SELECT id, slug, endpoint_url, verification_status, consecutive_health_fails
       FROM agents
      WHERE kind = 'public'
        AND endpoint_url IS NOT NULL
        AND archived_at IS NULL
        AND verification_status IN ('unverified','verified','degraded')
      ORDER BY last_health_check_at NULLS FIRST
      LIMIT $1`,
    [BATCH_SIZE],
  );

  let ok = 0;
  let fail = 0;
  for (const a of r.rows) {
    const probe = await probeOnce(a.endpoint_url);
    if (probe.ok) {
      ok++;
      await pool.query(
        `UPDATE agents
            SET verification_status = 'verified',
                consecutive_health_fails = 0,
                last_health_check_at = NOW()
          WHERE id = $1`,
        [a.id],
      );
    } else {
      fail++;
      const fails = a.consecutive_health_fails + 1;
      const status =
        fails >= DORMANT_THRESHOLD ? 'dormant' :
        fails >= DEGRADED_THRESHOLD ? 'degraded' :
        a.verification_status;
      await pool.query(
        `UPDATE agents
            SET verification_status = $2,
                consecutive_health_fails = $3,
                last_health_check_at = NOW()
          WHERE id = $1`,
        [a.id, status, fails],
      );
    }
  }
  return { checked: r.rowCount ?? 0, ok, fail };
}

export function startAgentHealthCanary(): void {
  if (process.env.FEATURE_PUBLIC_AGENT_ONBOARD !== 'true') {
    console.log('[canary] disabled (FEATURE_PUBLIC_AGENT_ONBOARD not true)');
    return;
  }
  console.log(`[canary] starting, interval=${CANARY_INTERVAL_MS}ms`);
  const tick = async () => {
    try {
      const stats = await runOnce();
      if (stats.checked > 0) console.log(`[canary] tick checked=${stats.checked} ok=${stats.ok} fail=${stats.fail}`);
    } catch (err) {
      console.error('[canary] tick failed', (err as Error).message);
    }
  };
  // initial tick after 30s so worker boot doesn't slam the DB cold
  setTimeout(tick, 30_000);
  setInterval(tick, CANARY_INTERVAL_MS);
}
