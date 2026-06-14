/**
 * migrate-to-supabase.ts — one-shot data copy from the legacy testnet
 * Postgres into the new Supabase project. Preserves marketplace metadata
 * (creators + listings + earnings history) and explicitly DROPS the entire
 * Sui surface (memwal_*, walrus_*, sui_* tables).
 *
 * Run order:
 *   1. provision Supabase, set SUPABASE env vars
 *   2. `npm run db:migrate` against Supabase (applies 001..026)
 *   3. `LEGACY_DATABASE_URL=... npx tsx scripts/migrate-to-supabase.ts`
 *      → copies rows, marks brain payloads needs_reupload
 *   4. apply 027_drop_sui_tables.sql (drops Sui-only tables, consumes
 *      the needs_reupload marker into the new payload_status column)
 *
 * Idempotent: every INSERT uses ON CONFLICT DO NOTHING, so reruns add only
 * net-new rows. Set DRY_RUN=1 to print row counts without writing.
 *
 * Usage:
 *   LEGACY_DATABASE_URL=postgres://user:pw@old-host/db \
 *   DATABASE_URL=postgres://postgres:pw@db.<ref>.supabase.co/postgres \
 *   npx tsx scripts/migrate-to-supabase.ts
 */

import { Client } from 'pg';

const DRY = process.env.DRY_RUN === '1';

// Tables migrated verbatim. Order matters where FK constraints exist —
// `sellers` before `agents`, `brains` before `paid_calls`.
const TABLES = [
  'sellers',
  'brains',
  'agents',
  'cognitive_workflows',
  'paid_calls',
  'chain_ops_queue',
  'onboard_permits_spent',
];

async function main() {
  const legacyUrl = process.env.LEGACY_DATABASE_URL;
  const targetUrl = process.env.DATABASE_URL;
  if (!legacyUrl || !targetUrl) {
    throw new Error('LEGACY_DATABASE_URL and DATABASE_URL must be set');
  }

  const src = new Client({ connectionString: legacyUrl });
  const dst = new Client({ connectionString: targetUrl });
  await Promise.all([src.connect(), dst.connect()]);

  try {
    for (const table of TABLES) {
      // Skip tables that don't exist on the source (newer projects may not
      // have run every migration historically).
      const exists = await tableExists(src, table);
      if (!exists) {
        console.log(`SKIP ${table} — not present on source`);
        continue;
      }
      const rows = await src.query(`SELECT * FROM ${table}`);
      console.log(
        `${DRY ? 'DRY ' : ''}${table}: copying ${rows.rowCount ?? 0} rows`,
      );
      if (DRY || rows.rowCount === 0) continue;

      const cols = Object.keys(rows.rows[0]);
      const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
      const colList = cols.map((c) => `"${c}"`).join(', ');
      const sql =
        `INSERT INTO ${table} (${colList}) VALUES (${placeholders})` +
        ` ON CONFLICT DO NOTHING`;

      for (const row of rows.rows) {
        // Brains lose their Walrus blob — flag for re-upload. The 027
        // migration consumes this marker into `payload_status` and strips
        // the JSONB key, so we don't pollute long-term.
        if (table === 'brains') {
          row.metadata = { ...(row.metadata ?? {}), payload_status: 'needs_reupload' };
        }
        const values = cols.map((c) => row[c]);
        try {
          await dst.query(sql, values);
        } catch (err: any) {
          // Most failures are "column does not exist" because the source
          // had Sui-specific columns we don't carry over. Skip + log.
          console.warn(`  warn: ${table}#${row.id ?? '?'}: ${err.message}`);
        }
      }
    }
    console.log('migration complete');
  } finally {
    await Promise.all([src.end(), dst.end()]);
  }
}

async function tableExists(c: Client, name: string): Promise<boolean> {
  const r = await c.query(
    `SELECT 1 FROM information_schema.tables WHERE table_name = $1 LIMIT 1`,
    [name],
  );
  return (r.rowCount ?? 0) > 0;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
