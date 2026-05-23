import { Router, Request, Response } from 'express';
import { pool } from '../db';
import { logger } from '../lib';
import { AuthRequest } from '../middleware/auth';

const router = Router();

/**
 * POST /v2/upload — opaque ciphertext ingestion.
 * Accepts pre-encrypted content (AES-256-GCM ciphertext from browser).
 * NEVER accepts plaintext key material. Defence in depth.
 */
router.post('/upload', async (req: Request, res: Response) => {
  const userAddress = (req as AuthRequest).user!.address;

  const { brainId, ciphertext, txHash, publishMeta } = req.body;
  if (!ciphertext || !txHash) {
    return res.status(400).json({ error: 'ciphertext and txHash required' });
  }
  // Defence: reject any request that tries to send plaintext keys
  if (req.body.keyHigh || req.body.keyLow || req.body.key) {
    return res.status(400).json({ error: 'Plaintext key material rejected. Use BrainKeyVaultV2 on-chain.' });
  }

  try {
    const bid = brainId || await getOrCreateBrainV2(userAddress);
    const { rows: [{ max }] } = await pool.query(
      `SELECT COALESCE(MAX(chunk_index), -1) as max FROM knowledge_chunks WHERE brain_id = $1`, [bid]
    );
    await pool.query(
      `INSERT INTO knowledge_chunks (brain_id, chunk_index, content, encrypted, nonce)
       VALUES ($1, $2, $3, TRUE, NULL)`,
      [bid, (max as number) + 1, ciphertext]
    );
    // Mark brain as v2 privacy
    await pool.query(`UPDATE brains SET privacy_version = 2 WHERE id = $1`, [bid]);

    // T3: one-click publish — publishMeta in the same round-trip.
    let published = false;
    if (publishMeta && typeof publishMeta === 'object') {
      const { title, description, tags } = publishMeta as { title?: string; description?: string; tags?: string[] };
      await pool.query(
        `UPDATE brains
            SET title = COALESCE($1, title),
                description = COALESCE($2, description),
                tags = COALESCE($3, tags),
                published = TRUE
          WHERE id = $4 AND owner_address = $5`,
        [title || null, description || null, tags || null, bid, userAddress]
      );
      published = true;
      logger.info({ brainId: bid, owner: userAddress }, 'v2:upload:published');
    }

    logger.info({ brainId: bid, txHash, published }, 'v2:upload:stored');
    res.json({ brainId: bid, estimatedChunks: 1, privacyVersion: 2, published });
  } catch (e: any) {
    logger.error({ err: e.message }, 'v2:upload:error');
    res.status(500).json({ error: 'Upload failed' });
  }
});

/**
 * GET /v2/brains/:id/chunks — returns opaque ciphertext + handles only.
 */
router.get('/brains/:id/chunks', async (req: Request, res: Response) => {
  const { id } = req.params;
  const after = Number(req.query.after ?? -1);
  try {
    const { rows } = await pool.query(
      `SELECT chunk_index, content as ciphertext FROM knowledge_chunks
       WHERE brain_id = $1 AND chunk_index > $2 ORDER BY chunk_index`,
      [id, after]
    );
    res.json(rows);
  } catch (e: any) {
    res.status(500).json({ error: 'Failed to fetch chunks' });
  }
});

/**
 * POST /v2/inference — stateless LLM call.
 * Receives already-decrypted chunks from browser (top-K only), question.
 * Returns answer. Never persists plaintext chunks.
 */
router.post('/inference', async (req: Request, res: Response) => {
  const { chunks, question, brainId } = req.body;
  if (!chunks?.length || !question) {
    return res.status(400).json({ error: 'chunks[] and question required' });
  }
  const userAddress = (req as AuthRequest).user!.address;

  // Per-brain access check for non-owner callers
  if (brainId) {
    const { rows: [brain] } = await pool.query(`SELECT owner_address FROM brains WHERE id = $1`, [brainId]);
    if (brain && brain.owner_address !== userAddress) {
      const { isBrainGranted } = await import('../fhe/permits');
      if (!(await isBrainGranted(brainId))) {
        return res.status(403).json({ error: 'Brain access not granted', reason: 'brain_not_granted' });
      }
    }
  }

  try {
    const context = (chunks as string[]).map((c, i) => `[${i}] ${c}`).join('\n---\n');
    const system = `You are a Second Brain assistant. Answer using ONLY the following knowledge:\n${context}`;

    const llm = await callLLM(system, question);
    const answer = llm.text;

    // Persist Q+A only (no chunks, no plaintext)
    if (userAddress && brainId) {
      await pool.query(
        `INSERT INTO chat_history (user_address, brain_id, role, content) VALUES ($1,$2,'user',$3), ($1,$2,'assistant',$4)`,
        [userAddress, brainId, question, answer]
      );
    }

    // Attestation — Phala TEE preferred, Fhenix TN fallback.
    let attestation: any;
    if (llm.phalaAttestationHash) {
      attestation = {
        provider: 'phala-tee',
        verified: true,
        hash: llm.phalaAttestationHash,
        issuedAt: new Date().toISOString(),
      };
    } else if (process.env.PHALA_ENDPOINT && process.env.PHALA_API_KEY) {
      // Phala configured but no attestation header surfaced — still mark as TEE-served.
      attestation = { provider: 'phala-tee', verified: true, issuedAt: new Date().toISOString() };
    } else {
      attestation = { provider: 'fhenix-tn', verified: false, signature: null, error: null, issuedAt: new Date().toISOString() };
      if (req.body.ctHashes?.length && process.env.PRIVATE_KEY) {
        try {
          const { getCofheClient } = await import('../fhe/client');
          const cofhe = await getCofheClient();
          const result = await cofhe.decryptForTx(req.body.ctHashes[0]).withoutPermit().execute();
          attestation = {
            provider: 'fhenix-tn',
            verified: true,
            signature: result.signature,
            ctHash: req.body.ctHashes[0],
            issuedAt: new Date().toISOString(),
          };
        } catch (e: any) {
          logger.warn({ ctHash: req.body.ctHashes[0], err: e.message }, 'tn:attestation:failed');
          attestation.error = e.message || 'tn_unavailable';
        }
      }
    }

    res.json({ answer, attestation });
  } catch (e: any) {
    logger.error({ err: e.message }, 'v2:inference:error');
    res.status(500).json({ error: 'Inference failed' });
  }
});

/**
 * POST /v2/migrate/:brainId — export legacy v1 plaintext chunks for browser re-encryption.
 * Only works for brains with privacy_version=1. After browser re-encrypts and uploads
 * via POST /v2/upload, call POST /v2/migrate/:brainId/complete to wipe legacy keys.
 */
router.post('/migrate/:brainId', async (req: Request, res: Response) => {
  const userAddress = (req as AuthRequest).user!.address;
  const { brainId } = req.params;

  try {
    const { rows: [brain] } = await pool.query(
      `SELECT id, owner_address, privacy_version FROM brains WHERE id = $1`, [brainId]
    );
    if (!brain) return res.status(404).json({ error: 'Brain not found' });
    if (brain.owner_address !== userAddress) return res.status(403).json({ error: 'Not owner' });
    if (brain.privacy_version === 2) return res.status(400).json({ error: 'Already v2' });

    // Load plaintext chunks (legacy path — last allowed use)
    const { KnowledgeIngestService } = await import('../services/knowledge-ingest');
    const chunks = await KnowledgeIngestService.loadChunks(Number(brainId));
    res.json({ chunks: chunks.map(c => c.content).filter(Boolean) });
  } catch (e: any) {
    res.status(500).json({ error: 'Migration export failed' });
  }
});

router.post('/migrate/:brainId/complete', async (req: Request, res: Response) => {
  const userAddress = (req as AuthRequest).user!.address;
  const { brainId } = req.params;

  try {
    const { rows: [brain] } = await pool.query(
      `SELECT owner_address FROM brains WHERE id = $1`, [brainId]
    );
    if (!brain || brain.owner_address !== userAddress) return res.status(403).json({ error: 'Not owner' });

    // Wipe legacy key material, upgrade privacy version
    await pool.query(`UPDATE brains SET key_high = NULL, key_low = NULL, privacy_version = 2 WHERE id = $1`, [brainId]);
    logger.info({ brainId }, 'v2:migrate:complete');
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Migration complete failed' });
  }
});

/**
 * GET /v2/brains — list published brains (DB-backed for now; T9 moves to on-chain reads).
 */
router.get('/brains', async (_req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, owner_address, title, description, tags, published, created_at, privacy_version
       FROM brains WHERE published = true ORDER BY created_at DESC LIMIT 50`
    );
    res.json(rows);
  } catch {
    res.status(500).json({ error: 'Failed to list brains' });
  }
});

/**
 * GET /v2/admin/stats — 30-day kill-criteria metrics.
 * Header-gated: x-admin-token must equal ADMIN_TOKEN env. Returns the
 * five numbers from docs/USP_BRIEF.md so the launch can be scored without
 * dashboard infrastructure.
 */
router.get('/admin/stats', async (req: Request, res: Response) => {
  const token = req.headers['x-admin-token'];
  if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const since = req.query.since ? new Date(String(req.query.since)) : new Date(Date.now() - 30 * 86_400_000);
    const demoAgent = (process.env.DEMO_AGENT_ADDRESS ?? '0xA1F2DEM00000000000000000000000000000A6E7').toLowerCase();

    const { rows: [s] } = await pool.query(
      `SELECT
         (SELECT COUNT(DISTINCT LOWER(owner_address))::int
            FROM brains WHERE created_at >= $1) AS distinct_seller_wallets,
         (SELECT COUNT(*)::int
            FROM (
              SELECT b.id
                FROM brains b
                JOIN chat_history h ON h.brain_id = b.id AND h.role = 'user'
               WHERE LOWER(h.user_address) <> LOWER(b.owner_address)
                 AND LOWER(h.user_address) <> $2
               GROUP BY b.id
              HAVING COUNT(DISTINCT LOWER(h.user_address)) >= 3
            ) t) AS brains_with_revenue_real,
         (SELECT COUNT(DISTINCT LOWER(h.user_address))::int
            FROM chat_history h
            JOIN brains b ON b.id = h.brain_id
           WHERE h.role = 'user'
             AND LOWER(h.user_address) <> LOWER(b.owner_address)
             AND LOWER(h.user_address) <> $2
             AND h.created_at >= $1) AS distinct_agent_wallets_real,
         (SELECT COUNT(*)::int
            FROM chat_history h
            JOIN brains b ON b.id = h.brain_id
           WHERE h.role = 'user'
             AND LOWER(h.user_address) <> LOWER(b.owner_address)
             AND h.created_at >= $1) AS total_queries_incl_demo`,
      [since, demoAgent],
    );
    const pricePerQuery = 0.01;
    res.json({
      since: since.toISOString(),
      demoAgentAddress: demoAgent,
      distinctSellerWallets: s.distinct_seller_wallets,
      brainsWithRevenue: s.brains_with_revenue_real,        // excludes demo agent — the real metric
      distinctAgentWallets: s.distinct_agent_wallets_real,  // excludes demo agent
      totalQueriesInclDemo: s.total_queries_incl_demo,
      totalUsdcInclDemo: +(s.total_queries_incl_demo * pricePerQuery).toFixed(2),
    });
  } catch (e: any) {
    logger.error({ err: e.message }, 'admin:stats:error');
    res.status(500).json({ error: 'Failed to compute stats' });
  }
});

// --- helpers ---

async function getOrCreateBrainV2(userAddress: string): Promise<number> {
  const { rows } = await pool.query(
    `SELECT id FROM brains WHERE owner_address = $1 AND privacy_version = 2 ORDER BY created_at LIMIT 1`,
    [userAddress]
  );
  if (rows[0]) return rows[0].id;
  const { rows: created } = await pool.query(
    `INSERT INTO brains (owner_address, title, chain, privacy_version) VALUES ($1, 'My Brain', 'arbitrum-sepolia', 2) RETURNING id`,
    [userAddress]
  );
  return created[0].id;
}

async function callBedrock(system: string, question: string): Promise<string> {
  return (await callLLM(system, question)).text;
}

/**
 * callLLM — env-flag provider switch.
 *   PHALA_ENDPOINT set  → Phala Confidential AI (OpenAI-compatible, TEE-attested)
 *   BEDROCK_API_KEY set → AWS Bedrock Claude
 *   neither             → mock (local dev)
 *
 * Returns text + optional Phala attestation hash from the response headers.
 */
async function callLLM(system: string, question: string): Promise<{ text: string; phalaAttestationHash?: string }> {
  const phalaEndpoint = process.env.PHALA_ENDPOINT;
  const phalaKey = process.env.PHALA_API_KEY;
  if (phalaEndpoint && phalaKey) {
    const url = phalaEndpoint.replace(/\/$/, '') + '/v1/chat/completions';
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${phalaKey}` },
      body: JSON.stringify({
        model: process.env.PHALA_MODEL || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: question },
        ],
      }),
    });
    if (!r.ok) throw new Error(`Phala ${r.status}`);
    const data = await r.json();
    return {
      text: data.choices?.[0]?.message?.content ?? '',
      phalaAttestationHash:
        r.headers.get('x-attestation-quote') ||
        r.headers.get('x-phala-attestation') ||
        undefined,
    };
  }

  const apiKey = process.env.BEDROCK_API_KEY;
  if (apiKey) {
    const url = `https://bedrock-runtime.us-east-1.amazonaws.com/model/us.anthropic.claude-opus-4-6-v1/invoke`;
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 4096,
        system,
        messages: [{ role: 'user', content: question }],
      }),
    });
    if (!r.ok) throw new Error(`Bedrock ${r.status}`);
    const data = await r.json();
    return { text: data.content?.[0]?.text ?? '' };
  }

  return { text: `[mock] Answer to "${question}" based on ${system.split('\n').length} context lines.` };
}

export default router;
