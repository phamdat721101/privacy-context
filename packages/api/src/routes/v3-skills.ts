/**
 * /v3/skills — Standalone Skill product type CRUD + invoke.
 *
 * Mount: app.use('/v3/skills', auth, agentKya, v3SkillsRouter)
 *   - GET endpoints: open (catalog browsing).
 *   - POST endpoints: gated by requireSuiWallet (G2 isolation).
 *
 * Endpoints:
 *   POST   /v3/skills                — publish (auth + Sui)
 *   GET    /v3/skills                — list (filter ?author=, ?published=)
 *   GET    /v3/skills/:id            — fetch one
 *   POST   /v3/skills/:id/invoke     — pay + dispatch (auth + Sui)
 */

import { Router, Request, Response } from 'express';
import { pool } from '../db';
import { logger } from '../lib';
import type { AuthRequest } from '../middleware/auth';
import { requireSuiWallet } from '../middleware/require-sui-wallet';
import { dispatchSkill } from '../services/skills';

const router = Router();

router.post('/', requireSuiWallet, async (req: AuthRequest, res: Response) => {
  if (!req.user?.address) return res.status(401).json({ error: 'auth-required' });
  const body = req.body ?? {};
  const required = ['skill_key', 'sui_object_id', 'manifest_blob_id', 'name', 'endpoint', 'default_price_usdc', 'signer', 'signature'];
  for (const k of required) {
    if (body[k] === undefined || body[k] === null) {
      return res.status(400).json({ error: 'missing-field', field: k });
    }
  }
  try {
    const r = await pool.query(
      `INSERT INTO cognitive_skills_marketplace
         (skill_key, author_addr, sui_object_id, manifest_blob_id, name, description,
          endpoint, input_schema, output_schema, default_price_usdc,
          published, kya_required, min_reputation, signer, signature)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11,$12,$13,$14,$15)
       RETURNING id, skill_key, sui_object_id, name, default_price_usdc, published`,
      [
        body.skill_key,
        req.user.address.toLowerCase(),
        body.sui_object_id,
        body.manifest_blob_id,
        body.name,
        body.description ?? '',
        JSON.stringify(body.endpoint),
        JSON.stringify(body.input_schema ?? {}),
        JSON.stringify(body.output_schema ?? {}),
        body.default_price_usdc,
        body.published ?? false,
        body.kya_required ?? false,
        body.min_reputation ?? 0,
        body.signer,
        body.signature,
      ],
    );
    res.status(201).json(r.rows[0]);
  } catch (err: any) {
    logger.warn({ err: err?.message }, 'v3-skills:publish:failed');
    if (err?.code === '23505') return res.status(409).json({ error: 'duplicate' });
    res.status(500).json({ error: 'publish-failed' });
  }
});

router.get('/', async (req: Request, res: Response) => {
  const author = (req.query.author as string | undefined)?.toLowerCase();
  const published = String(req.query.published ?? '').toLowerCase() === 'true';
  const where: string[] = [];
  const params: any[] = [];
  if (author) {
    params.push(author);
    where.push(`author_addr = $${params.length}`);
  }
  if (published) where.push(`published = true`);
  const sql = `SELECT id, skill_key, author_addr, sui_object_id, name, description,
                       default_price_usdc, invocations, published, created_at
                FROM cognitive_skills_marketplace
                ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                ORDER BY created_at DESC LIMIT 100`;
  const r = await pool.query(sql, params);
  res.json(r.rows);
});

router.get('/:id', async (req: Request, res: Response) => {
  const r = await pool.query(`SELECT * FROM cognitive_skills_marketplace WHERE id = $1`, [req.params.id]);
  if ((r.rowCount ?? 0) === 0) return res.status(404).json({ error: 'not-found' });
  res.json(r.rows[0]);
});

router.post('/:id/invoke', requireSuiWallet, async (req: AuthRequest, res: Response) => {
  if (!req.user?.address) return res.status(401).json({ error: 'auth-required' });
  const r = await pool.query(
    `SELECT id, sui_object_id, endpoint, default_price_usdc, published
       FROM cognitive_skills_marketplace WHERE id = $1`,
    [req.params.id],
  );
  if ((r.rowCount ?? 0) === 0) return res.status(404).json({ error: 'not-found' });
  const skill = r.rows[0];
  if (!skill.published) return res.status(400).json({ error: 'NOT_PUBLISHED' });
  if (!skill.sui_object_id) return res.status(400).json({ error: 'NOT_SUI_RESIDENT' });

  const endpoint = skill.endpoint as { type: string; ref: string };
  const input = (req.body?.input as Record<string, unknown>) ?? {};
  try {
    let output: unknown;
    if (endpoint.type === 'internal') {
      output = await dispatchSkill(endpoint.ref, input);
    } else {
      const fr = await fetch(endpoint.ref, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input }),
      });
      if (!fr.ok) throw new Error(`external skill ${fr.status}`);
      output = await fr.json();
    }
    await pool.query(
      `UPDATE cognitive_skills_marketplace SET invocations = invocations + 1 WHERE id = $1`,
      [skill.id],
    );
    res.json({
      output,
      pricePaidUsdc: skill.default_price_usdc,
      txHash: `mock-skill-${skill.id}-${Date.now()}`,
    });
  } catch (err: any) {
    logger.warn({ err: err?.message }, 'v3-skills:invoke:failed');
    res.status(500).json({ error: 'invoke-failed', message: err?.message });
  }
});

export default router;
