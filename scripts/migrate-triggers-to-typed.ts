#!/usr/bin/env tsx
/**
 * migrate-triggers-to-typed — one-shot data migration for PRD-U3.
 *
 * Reads every `agent_skills.trigger_patterns` row; if it's still in the
 * legacy string-array shape (Jul 3), rewrites it to the typed
 * `[{ type: 'keyword', match: [...], weight: 1 }]` shape used by
 * `agentOrchestrationService.loadSkills` at scoring time.
 *
 * IDEMPOTENT — running twice = no changes second run. Rows already in
 * typed shape are left untouched.
 *
 * COSMETIC — `normalizePatterns` in the service handles both shapes at
 * read time, so this script is optional. Running it makes the DB rows
 * self-describing (easier ops + queries) and unlocks new pattern types
 * (task_type, regex) via the studio UI in v1.1.
 *
 * Usage:
 *   DATABASE_URL=postgres://… tsx scripts/migrate-triggers-to-typed.ts
 *   DATABASE_URL=postgres://… tsx scripts/migrate-triggers-to-typed.ts --dry-run
 */

/* eslint-disable no-console */

import { Pool } from 'pg';

const DRY_RUN = process.argv.includes('--dry-run');

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const pool = new Pool({ connectionString: url });

  try {
    const r = await pool.query<{ id: string; slug: string; trigger_patterns: unknown }>(
      `SELECT id, slug, trigger_patterns FROM agent_skills WHERE trigger_patterns IS NOT NULL`,
    );
    console.log(`Scanning ${r.rowCount ?? 0} agent_skills rows`);

    let converted = 0;
    let alreadyTyped = 0;
    let empty = 0;

    for (const row of r.rows) {
      const raw = row.trigger_patterns;
      if (!Array.isArray(raw) || raw.length === 0) {
        empty++;
        continue;
      }

      // Detect legacy shape: array of strings.
      const isLegacyStringArray = raw.every((it) => typeof it === 'string');
      // Detect typed shape: array of {type, match|pattern}.
      const isTypedArray = raw.every(
        (it) =>
          it &&
          typeof it === 'object' &&
          !Array.isArray(it) &&
          typeof (it as Record<string, unknown>).type === 'string',
      );

      if (isTypedArray) {
        alreadyTyped++;
        continue;
      }
      if (!isLegacyStringArray) {
        console.warn(`  skip ${row.slug} (${row.id}) — mixed/unknown shape`);
        continue;
      }

      const typed = [
        {
          type: 'keyword' as const,
          match: (raw as string[]).map((s) => s.trim()).filter(Boolean),
          weight: 1,
        },
      ];

      if (DRY_RUN) {
        console.log(`  would convert ${row.slug} (${row.id}): ${JSON.stringify(raw)} → ${JSON.stringify(typed)}`);
      } else {
        await pool.query(
          `UPDATE agent_skills SET trigger_patterns = $1::jsonb, updated_at = now() WHERE id = $2`,
          [JSON.stringify(typed), row.id],
        );
      }
      converted++;
    }

    console.log('');
    console.log(`Summary${DRY_RUN ? ' (DRY RUN — no writes)' : ''}:`);
    console.log(`  converted:      ${converted}`);
    console.log(`  already typed:  ${alreadyTyped}`);
    console.log(`  empty/skipped:  ${empty}`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error('migrate-triggers-to-typed:fatal', e);
  process.exit(2);
});
