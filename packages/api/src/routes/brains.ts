import { Router } from 'express';
import { auth, AuthRequest } from '../middleware/auth';
import { pool } from '../db';

const router = Router();

router.get('/', async (req, res) => {
  const { page = '1', limit = '20' } = req.query;
  const offset = (+page - 1) * +limit;
  const { rows } = await pool.query(
    `SELECT id, owner_address, title, description, tags, created_at FROM brains WHERE published = true ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
    [+limit, offset]
  );
  res.json(rows);
});

router.get('/search', async (req, res) => {
  const { q = '', tags } = req.query;
  const tagArr = tags ? (tags as string).split(',') : [];
  const { rows } = await pool.query(
    `SELECT id, owner_address, title, description, tags, created_at FROM brains WHERE published = true AND (title ILIKE $1 OR description ILIKE $1 OR tags && $2::text[]) LIMIT 20`,
    [`%${q}%`, tagArr]
  );
  res.json(rows);
});

router.get('/mine', auth, async (req: AuthRequest, res) => {
  const { rows } = await pool.query(
    `SELECT * FROM brains WHERE owner_address = $1 ORDER BY created_at DESC`,
    [req.user!.address]
  );
  res.json(rows);
});

/**
 * GET /brains/earnings/:wallet — what this seller has earned.
 * Auth-gated; sellers see only their own. Sellers do NOT need a subscription.
 *
 * Earnings model (v0): every chat_history row authored by a non-owner is
 * counted as one paid query at PRICE_PER_QUERY_USDC. Demo agent traffic is
 * deliberately included — the seller seeing traffic IS the magic moment.
 */
const PRICE_PER_QUERY_USDC = 0.01;
router.get('/earnings/:wallet', auth, async (req: AuthRequest, res) => {
  const wallet = req.params.wallet.toLowerCase();
  if (req.user!.address.toLowerCase() !== wallet) {
    return res.status(403).json({ error: 'Can only view your own earnings' });
  }
  try {
    const { rows: brains } = await pool.query(
      `SELECT b.id, b.title, b.tags,
              COUNT(h.id) FILTER (WHERE h.role = 'user' AND LOWER(h.user_address) <> LOWER(b.owner_address)) AS query_count,
              MAX(h.created_at) FILTER (WHERE h.role = 'user' AND LOWER(h.user_address) <> LOWER(b.owner_address)) AS last_at
         FROM brains b
         LEFT JOIN chat_history h ON h.brain_id = b.id
        WHERE LOWER(b.owner_address) = $1
        GROUP BY b.id
        ORDER BY query_count DESC NULLS LAST, b.id DESC`,
      [wallet],
    );
    const { rows: receipts } = await pool.query(
      `SELECT h.brain_id, h.user_address AS agent_address, h.created_at, b.title AS brain_title
         FROM chat_history h
         JOIN brains b ON b.id = h.brain_id
        WHERE h.role = 'user'
          AND LOWER(b.owner_address) = $1
          AND LOWER(h.user_address) <> $1
        ORDER BY h.created_at DESC
        LIMIT 50`,
      [wallet],
    );

    const totalQueries = brains.reduce((s, r) => s + Number(r.query_count || 0), 0);
    const totalUsdc = +(totalQueries * PRICE_PER_QUERY_USDC).toFixed(2);
    res.json({
      wallet,
      pricePerQueryUsdc: PRICE_PER_QUERY_USDC,
      totalQueries,
      totalUsdc,
      brains: brains.map((b) => ({
        id: b.id,
        title: b.title,
        tags: b.tags ?? [],
        queryCount: Number(b.query_count || 0),
        earnedUsdc: +((Number(b.query_count || 0)) * PRICE_PER_QUERY_USDC).toFixed(2),
        lastAt: b.last_at,
      })),
      receipts: receipts.map((r) => ({
        brainId: r.brain_id,
        brainTitle: r.brain_title,
        agentAddress: r.agent_address,
        amount: PRICE_PER_QUERY_USDC.toFixed(2),
        currency: 'USDC',
        at: r.created_at,
      })),
    });
  } catch (e: any) {
    res.status(500).json({ error: 'Failed to load earnings' });
  }
});

router.post('/create', auth, async (req: AuthRequest, res) => {
  // Single permit gate for the creator funnel.
  // Onboarding flow is `login → permit → create`. Once a wallet has a brain
  // it has, by construction, held a permit at some point — so /upload and
  // /brains/publish stay open and rely on ownership instead of re-checking.
  if (!req.user?.hasPermit) {
    return res.status(403).json({
      error: 'Permit required',
      reason: req.user?.permitReason ?? 'never_authorized',
      message: 'Authorize the FHE permit before creating your first agent.',
    });
  }
  const { title = 'New Brain' } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO brains (owner_address, title, chain) VALUES ($1, $2, 'arbitrum-sepolia') RETURNING *`,
    [req.user!.address, title]
  );
  res.json(rows[0]);
});

router.get('/:id', async (req, res) => {
  const { rows } = await pool.query(`SELECT * FROM brains WHERE id = $1`, [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Brain not found' });
  res.json(rows[0]);
});

router.post('/publish', auth, async (req: AuthRequest, res) => {
  // Publish is a DB-flag flip plus a fire-and-forget on-chain call signed by
  // the platform wallet. The user's FHE permit is irrelevant here — ownership
  // is enforced by the WHERE owner_address = req.user.address clause below.
  const { brainId, title, description, tags } = req.body;
  let txHash: string | null = null;
  if (brainId) {
    const { rows } = await pool.query(
      `UPDATE brains SET title = COALESCE($1, title), description = COALESCE($2, description), tags = COALESCE($3, tags), published = true WHERE id = $4 AND owner_address = $5 RETURNING *`,
      [title, description, tags || [], brainId, req.user!.address]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Brain not found or not owned' });
    // On-chain publish (fire-and-forget)
    try {
      const { ethers } = await import('ethers');
      const addr = process.env.KNOWLEDGE_REGISTRY_ADDRESS;
      if (process.env.PRIVATE_KEY && addr) {
        const provider = new ethers.JsonRpcProvider(process.env.ARBITRUM_SEPOLIA_RPC || 'https://sepolia-rollup.arbitrum.io/rpc');
        const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
        const contract = new ethers.Contract(addr, ['function publish(uint256 brainId)'], wallet);
        const tx = await contract.publish(brainId);
        txHash = tx.hash;
      }
    } catch {}
    return res.json({ ...rows[0], txHash });
  }
  const { rows } = await pool.query(
    `INSERT INTO brains (owner_address, title, description, tags, published, chain) VALUES ($1,$2,$3,$4,true,'arbitrum-sepolia') RETURNING *`,
    [req.user!.address, title || 'Untitled', description || '', tags || []]
  );
  res.json(rows[0]);
});

export default router;
