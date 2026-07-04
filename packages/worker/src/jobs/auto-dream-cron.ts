/**
 * auto-dream-cron — weekly Sunday 03:00 UTC trigger for PRD-U4 auto-dream.
 *
 * The worker container hosts this loop for HTTP event-loop isolation
 * (per user choice 6=b). The actual 4-phase dream logic lives in the api's
 * `autoDreamService`; this cron fires a single HTTP POST to the internal
 * endpoint and returns — the api then runs dreams in bounded-concurrency
 * background without blocking a Caddy connection.
 *
 * No-op when FEATURE_AUTO_DREAM=false (byte-identical rollback).
 *
 * SOLID:
 *   • SRP — only schedules + kicks; the api owns dream execution.
 *   • DIP — talks to the api via HTTP, no cross-package imports.
 */

import 'dotenv/config';

const OPENX_API_URL = process.env.OPENX_API_URL ?? 'http://127.0.0.1:3001';
const INTERNAL_SECRET = process.env.OPENX_INTERNAL_SECRET ?? '';

// Weekly cadence in ms — 7 days. Actual firing time within the week depends
// on when the worker last started; for tighter "always Sunday 03:00 UTC"
// scheduling upgrade to node-cron in v1.1. Anthropic Auto-Dream doesn't
// require exact wall-clock; weekly-ish is fine.
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
// Delay first run 30s after boot so migrations + api warmup complete.
const BOOT_DELAY_MS = Math.max(1_000, Number(process.env.OPENX_AUTO_DREAM_BOOT_DELAY_MS ?? 30_000));
// Timeout per POST — the api endpoint returns 202 in <1s after firing.
const POST_TIMEOUT_MS = 15_000;

async function tick(): Promise<void> {
  const flag = process.env.FEATURE_AUTO_DREAM === 'true';
  if (!flag) {
    console.log('[auto-dream-cron] FEATURE_AUTO_DREAM=false, skipping tick');
    return;
  }
  if (!INTERNAL_SECRET) {
    console.warn('[auto-dream-cron] OPENX_INTERNAL_SECRET missing, skipping tick');
    return;
  }

  const url = `${OPENX_API_URL.replace(/\/$/, '')}/v3/internal/cron/auto-dream`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), POST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-openx-internal-secret': INTERNAL_SECRET,
      },
      body: '{}',
      signal: ac.signal,
    });
    const text = await res.text();
    console.log(`[auto-dream-cron] POST ${url} → ${res.status} ${text.slice(0, 200)}`);
  } catch (err) {
    console.error(`[auto-dream-cron] fetch error: ${(err as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}

export function startAutoDreamCron(): void {
  if (process.env.FEATURE_AUTO_DREAM !== 'true') {
    console.log('[auto-dream-cron] disabled (FEATURE_AUTO_DREAM=false)');
    return;
  }
  console.log(`[auto-dream-cron] enabled — first tick in ${BOOT_DELAY_MS}ms, then every ${WEEK_MS / 1000}s`);
  setTimeout(() => {
    void tick();
    setInterval(() => void tick(), WEEK_MS).unref();
  }, BOOT_DELAY_MS).unref();
}
