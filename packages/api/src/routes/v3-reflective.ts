/**
 * /v3/reflective — L5 ReflectiveTrace marketplace routes.
 *
 * Endpoints:
 *   POST   /v3/reflective                — publish a trace (auth + Sui)
 *   GET    /v3/reflective                — list (filter ?author=, ?workflow_id=)
 *   GET    /v3/reflective/:id            — fetch one
 *   POST   /v3/reflective/:id/license    — buy a license (auth + Sui)
 *   GET    /v3/reflective/mine           — licenses owned by current wallet (auth)
 *   POST   /v3/reflective/promote        — author-only: scan runs + auto-emit candidates
 *
 * The promote endpoint is the L4→L5 trigger: it reads
 * cognitive_workflow_runs for a given workflow, runs `promoteToReflective`
 * (deterministic), and returns the candidate body (unsigned). Author signs
 * client-side and re-POSTs via /v3/reflective.
 */

import { Router, Request, Response } from 'express';
import { pool } from '../db';
import { logger } from '../lib';
import type { AuthRequest } from '../middleware/auth';
import { requireSuiWallet } from '../middleware/require-sui-wallet';
import {
  promoteToReflective,
  type WorkflowRunReceipt,
} from '@fhe-ai-context/sdk';

const router = Router();

// POST /v3/reflective — publish.
router.post('/', requireSuiWallet, async (req: AuthRequest, res: Response) => {
  if (!req.user?.address) return res.status(401).json({ error: 'auth-required' });
  const body = req.body ?? {};
  const required = ['trace_key', 'workflow_id', 'sui_object_id', 'rules_blob_id', 'body', 'default_license_price_usdc', 'signer', 'signature'];
  for (const k of required) {
    if (body[k] === undefined || body[k] === null) {
      return res.status(400).json({ error: 'missing-field', field: k });
    }
  }
  try {
    const r = await pool.query(
      `INSERT INTO cognitive_reflective
         (trace_key, workflow_id, author_addr, sui_object_id, rules_blob_id, body,
          default_license_price_usdc, published, signer, signature, runs_observed)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11)
       RETURNING id, trace_key, sui_object_id, default_license_price_usdc, published`,
      [
        body.trace_key,
        body.workflow_id,
        req.user.address.toLowerCase(),
        body.sui_object_id,
        body.rules_blob_id,
        JSON.stringify(body.body),
        body.default_license_price_usdc,
        body.published ?? false,
        body.signer,
        body.signature,
        body.runs_observed ?? 0,
      ],
    );
    res.status(201).json(r.rows[0]);
  } catch (err: any) {
    logger.warn({ err: err?.message }, 'v3-reflective:publish:failed');
    if (err?.code === '23505') return res.status(409).json({ error: 'duplicate' });
    res.status(500).json({ error: 'publish-failed' });
  }
});

router.get('/', async (req: Request, res: Response) => {
  const author = (req.query.author as string | undefined)?.toLowerCase();
  const workflowId = req.query.workflow_id as string | undefined;
  const where: string[] = [];
  const params: any[] = [];
  if (author) {
    params.push(author);
    where.push(`author_addr = $${params.length}`);
  }
  if (workflowId) {
    params.push(workflowId);
    where.push(`workflow_id = $${params.length}`);
  }
  where.push('published = true');
  const sql = `SELECT id, trace_key, workflow_id, author_addr, sui_object_id, rules_blob_id,
                       default_license_price_usdc, runs_observed, licenses_sold, created_at
                FROM cognitive_reflective
                WHERE ${where.join(' AND ')}
                ORDER BY created_at DESC LIMIT 100`;
  const r = await pool.query(sql, params);
  res.json(r.rows);
});

router.get('/mine', async (req: AuthRequest, res: Response) => {
  if (!req.user?.address) return res.status(401).json({ error: 'auth-required' });
  const r = await pool.query(
    `SELECT l.id, l.trace_id, l.sui_license_id, l.paid_usdc, l.tx_hash, l.created_at,
            t.trace_key, t.workflow_id, t.rules_blob_id
       FROM cognitive_reflective_licenses l
       JOIN cognitive_reflective t ON t.id = l.trace_id
      WHERE l.licensee_addr = $1
      ORDER BY l.created_at DESC`,
    [req.user.address.toLowerCase()],
  );
  res.json(r.rows);
});

router.get('/:id', async (req: Request, res: Response) => {
  const r = await pool.query(`SELECT * FROM cognitive_reflective WHERE id = $1`, [req.params.id]);
  if ((r.rowCount ?? 0) === 0) return res.status(404).json({ error: 'not-found' });
  res.json(r.rows[0]);
});

// POST /v3/reflective/:id/license — record a license purchase.
router.post('/:id/license', requireSuiWallet, async (req: AuthRequest, res: Response) => {
  if (!req.user?.address) return res.status(401).json({ error: 'auth-required' });
  const body = req.body ?? {};
  if (!body.sui_license_id || !body.tx_hash) {
    return res.status(400).json({ error: 'missing-field' });
  }
  try {
    const t = await pool.query(
      `SELECT id, default_license_price_usdc FROM cognitive_reflective WHERE id = $1 AND published = true`,
      [req.params.id],
    );
    if ((t.rowCount ?? 0) === 0) return res.status(404).json({ error: 'not-found' });
    await pool.query('BEGIN');
    await pool.query(
      `INSERT INTO cognitive_reflective_licenses
         (trace_id, licensee_addr, sui_license_id, paid_usdc, tx_hash)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (trace_id, licensee_addr) DO NOTHING`,
      [req.params.id, req.user.address.toLowerCase(), body.sui_license_id, t.rows[0].default_license_price_usdc, body.tx_hash],
    );
    await pool.query(
      `UPDATE cognitive_reflective SET licenses_sold = licenses_sold + 1 WHERE id = $1`,
      [req.params.id],
    );
    await pool.query('COMMIT');
    res.status(201).json({ ok: true });
  } catch (err: any) {
    await pool.query('ROLLBACK');
    logger.warn({ err: err?.message }, 'v3-reflective:license:failed');
    res.status(500).json({ error: 'license-failed' });
  }
});

/**
 * POST /v3/reflective/promote
 * Body: { workflow_id }
 * Returns: { candidates: ReflectiveCandidate[] }
 *
 * Reads cognitive_workflow_runs for the workflow + invokes
 * `promoteToReflective`. Author then signs the candidate client-side and
 * re-publishes via POST /v3/reflective.
 */
router.post('/promote', async (req: AuthRequest, res: Response) => {
  if (!req.user?.address) return res.status(401).json({ error: 'auth-required' });
  const wfId = req.body?.workflow_id as string | undefined;
  if (!wfId) return res.status(400).json({ error: 'missing-workflow-id' });

  // Author-only — verify ownership.
  const own = await pool.query(
    `SELECT id FROM cognitive_workflows WHERE id = $1 AND author_addr = $2`,
    [wfId, req.user.address.toLowerCase()],
  );
  if ((own.rowCount ?? 0) === 0) return res.status(403).json({ error: 'not-author' });

  // Pull recent runs.
  const runs = await pool.query(
    `SELECT id, workflow_key, buyer, input_fingerprint, success, step_receipts,
            outputs_hash, total_usdc,
            EXTRACT(EPOCH FROM started_at) * 1000 AS started_at_ms,
            EXTRACT(EPOCH FROM ended_at) * 1000 AS ended_at_ms
       FROM cognitive_workflow_runs
      WHERE workflow_id = $1
      ORDER BY created_at DESC LIMIT 200`,
    [wfId],
  );

  const receipts: WorkflowRunReceipt[] = runs.rows.map((row: any) => ({
    runId: row.id,
    workflowKey: row.workflow_key,
    buyer: row.buyer,
    inputFingerprint: row.input_fingerprint,
    success: row.success,
    outputs: {},
    stepReceipts: row.step_receipts,
    totalUsdc: row.total_usdc,
    startedAt: Number(row.started_at_ms),
    endedAt: Number(row.ended_at_ms),
  }));

  if (receipts.length === 0) {
    return res.json({ candidates: [], reason: 'no-runs' });
  }

  // Fetch existing trace_keys for this workflow to dedup.
  const existing = await pool.query(
    `SELECT trace_key FROM cognitive_reflective WHERE workflow_id = $1`,
    [wfId],
  );
  const existingKeys = new Set<string>(existing.rows.map((r: any) => r.trace_key));

  const candidates = promoteToReflective({
    runs: receipts,
    existingTraceKeys: existingKeys,
    qualityScores: {},
  });

  res.json({ candidates });
});

export default router;
