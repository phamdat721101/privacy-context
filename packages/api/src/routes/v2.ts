import { Router, Request, Response } from 'express';
import { pool } from '../db';
import { logger } from '../lib';

const router = Router();

/**
 * POST /v2/upload — opaque ciphertext ingestion.
 * Accepts pre-encrypted content (AES-256-GCM ciphertext from browser).
 * NEVER accepts plaintext key material. Defence in depth.
 */
router.post('/upload', async (req: Request, res: Response) => {
  const userAddress = (req.headers['x-wallet-address'] as string)?.toLowerCase();
  if (!userAddress) return res.status(401).json({ error: 'x-wallet-address required' });

  const { brainId, ciphertext, txHash } = req.body;
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

    logger.info({ brainId: bid, txHash }, 'v2:upload:stored');
    res.json({ brainId: bid, estimatedChunks: 1, privacyVersion: 2 });
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
  const userAddress = (req.headers['x-wallet-address'] as string)?.toLowerCase();

  try {
    const context = (chunks as string[]).map((c, i) => `[${i}] ${c}`).join('\n---\n');
    const system = `You are a Second Brain assistant. Answer using ONLY the following knowledge:\n${context}`;

    const answer = await callBedrock(system, question);

    // Persist Q+A only (no chunks, no plaintext)
    if (userAddress && brainId) {
      await pool.query(
        `INSERT INTO chat_history (user_address, brain_id, role, content) VALUES ($1,$2,'user',$3), ($1,$2,'assistant',$4)`,
        [userAddress, brainId, question, answer]
      );
    }

    // TN signature — off-chain attestation (gasless per choice 1=c)
    // Server calls decryptForTx on the first chunk's ctHash to get a TN-signed proof
    // that this answer was derived from a real Fhenix-encrypted source.
    let attestation: any = { provider: 'fhenix-tn', verified: false, signature: null, issuedAt: new Date().toISOString() };
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
      } catch { /* TN unavailable — return unverified */ }
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
  const userAddress = (req.headers['x-wallet-address'] as string)?.toLowerCase();
  const { brainId } = req.params;
  if (!userAddress) return res.status(401).json({ error: 'x-wallet-address required' });

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
  const userAddress = (req.headers['x-wallet-address'] as string)?.toLowerCase();
  const { brainId } = req.params;
  if (!userAddress) return res.status(401).json({ error: 'x-wallet-address required' });

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
    return data.content?.[0]?.text ?? '';
  }
  // Fallback mock for local dev
  return `[mock] Answer to "${question}" based on ${system.split('\n').length} context lines.`;
}

export default router;
