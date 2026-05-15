import { Router } from 'express';
import { auth, AuthRequest } from '../middleware/auth';
import { subscriptionGate } from '../middleware/paywall';
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

router.get('/:id', async (req, res) => {
  const { rows } = await pool.query(`SELECT * FROM brains WHERE id = $1`, [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Brain not found' });
  res.json(rows[0]);
});

router.post('/publish', auth, subscriptionGate as any, async (req: AuthRequest, res) => {
  const { brainId, title, description, tags } = req.body;
  if (brainId) {
    const { rows } = await pool.query(
      `UPDATE brains SET title = COALESCE($1, title), description = COALESCE($2, description), tags = COALESCE($3, tags), published = true WHERE id = $4 AND owner_address = $5 RETURNING *`,
      [title, description, tags || [], brainId, req.user!.address]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Brain not found or not owned' });
    return res.json(rows[0]);
  }
  const { rows } = await pool.query(
    `INSERT INTO brains (owner_address, title, description, tags, published, chain) VALUES ($1,$2,$3,$4,true,'arbitrum-sepolia') RETURNING *`,
    [req.user!.address, title || 'Untitled', description || '', tags || []]
  );
  res.json(rows[0]);
});

export default router;
