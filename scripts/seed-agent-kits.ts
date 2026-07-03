#!/usr/bin/env tsx
/**
 * seed-agent-kits.ts — populate the 7 Day-1 web3 agent-kits.
 *
 * Reads every YAML file in `scripts/kits/*.yaml`, upserts three rows per kit:
 *   agent_kits             — kit row
 *   agent_kit_versions     — 1 latest version
 *   agent_kit_capabilities — N capabilities
 *
 * Idempotent: safe to re-run; kit_id resolved by slug UPSERT.
 *
 * Run:   DATABASE_URL=postgres://... npm run seed:kits
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import yaml from 'js-yaml';

interface KitYaml {
  slug: string;
  name: string;
  description: string;
  homepage_url?: string;
  license?: string;
  authors?: string[];
  trigger_type?: 'user' | 'model';
  leading_word: string;
  audit_score?: number;
  audit_pillars_pass?: Record<string, boolean>;
  npm_package?: string;
  github_repo?: string;
  install_command?: string;
  cost_install?: string;
  cost_per_use?: string;
  version: {
    version: string;
    release_date: string;
    skill_md_url?: string;
    skill_md_lines?: number;
    reference_urls?: string[];
    changelog?: string;
  };
  capabilities: Array<{
    capability_id: string;
    name: string;
    description?: string;
    chains?: string[];
    stablecoins?: string[];
    eval_task_ids?: string[];
  }>;
}

async function main(): Promise<void> {
  const dir = path.resolve(__dirname, 'kits');
  const files = readdirSync(dir).filter((f) => f.endsWith('.yaml'));
  if (files.length === 0) throw new Error(`no kit yaml files under ${dir}`);

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    for (const file of files.sort()) {
      const raw = readFileSync(path.join(dir, file), 'utf8');
      const kit = yaml.load(raw) as KitYaml;
      await client.query('BEGIN');
      await upsertKit(client, kit);
      await client.query('COMMIT');
      console.log(`✓ ${kit.slug}  (${kit.capabilities.length} capabilities)`);
    }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
  console.log(`\n${files.length} kits seeded.`);
}

async function upsertKit(client: pg.PoolClient, k: KitYaml): Promise<void> {
  const kitRow = await client.query<{ id: string }>(
    `INSERT INTO agent_kits (
        slug, name, description, homepage_url, license, authors,
        trigger_type, leading_word, audit_score, audit_pillars_pass,
        npm_package, github_repo, install_command,
        cost_install, cost_per_use, status
      ) VALUES (
        $1, $2, $3, $4, $5, $6::jsonb,
        $7, $8, $9, $10::jsonb,
        $11, $12, $13,
        $14, $15, 'active'
      )
      ON CONFLICT (slug) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        homepage_url = EXCLUDED.homepage_url,
        license = EXCLUDED.license,
        authors = EXCLUDED.authors,
        trigger_type = EXCLUDED.trigger_type,
        leading_word = EXCLUDED.leading_word,
        audit_score = EXCLUDED.audit_score,
        audit_pillars_pass = EXCLUDED.audit_pillars_pass,
        npm_package = EXCLUDED.npm_package,
        github_repo = EXCLUDED.github_repo,
        install_command = EXCLUDED.install_command,
        cost_install = EXCLUDED.cost_install,
        cost_per_use = EXCLUDED.cost_per_use,
        status = 'active',
        updated_at = now()
      RETURNING id`,
    [
      k.slug,
      k.name,
      k.description,
      k.homepage_url ?? null,
      k.license ?? 'MIT',
      JSON.stringify(k.authors ?? []),
      k.trigger_type ?? 'user',
      k.leading_word,
      k.audit_score ?? 0,
      JSON.stringify(k.audit_pillars_pass ?? {}),
      k.npm_package ?? null,
      k.github_repo ?? null,
      k.install_command ?? null,
      k.cost_install ?? 'free',
      k.cost_per_use ?? 'variable',
    ],
  );
  const kitId = kitRow.rows[0].id;

  // Reset latest flag then insert version (idempotent).
  await client.query(`UPDATE agent_kit_versions SET is_latest = false WHERE kit_id = $1`, [kitId]);
  await client.query(
    `INSERT INTO agent_kit_versions (
        kit_id, version, release_date, skill_md_url, skill_md_lines,
        reference_urls, changelog, is_latest
      ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, true)
      ON CONFLICT (kit_id, version) DO UPDATE SET
        release_date   = EXCLUDED.release_date,
        skill_md_url   = EXCLUDED.skill_md_url,
        skill_md_lines = EXCLUDED.skill_md_lines,
        reference_urls = EXCLUDED.reference_urls,
        changelog      = EXCLUDED.changelog,
        is_latest      = true`,
    [
      kitId,
      k.version.version,
      k.version.release_date,
      k.version.skill_md_url ?? null,
      k.version.skill_md_lines ?? 0,
      JSON.stringify(k.version.reference_urls ?? []),
      k.version.changelog ?? null,
    ],
  );

  // Replace capabilities atomically (delete-then-insert; small N).
  await client.query(`DELETE FROM agent_kit_capabilities WHERE kit_id = $1`, [kitId]);
  for (const c of k.capabilities) {
    await client.query(
      `INSERT INTO agent_kit_capabilities (
          kit_id, capability_id, name, description, chains, stablecoins, eval_task_ids
        ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb)`,
      [
        kitId,
        c.capability_id,
        c.name,
        c.description ?? null,
        JSON.stringify(c.chains ?? []),
        JSON.stringify(c.stablecoins ?? []),
        JSON.stringify(c.eval_task_ids ?? []),
      ],
    );
  }
}

main().catch((e) => {
  console.error('seed:kits failed:', e);
  process.exit(1);
});
