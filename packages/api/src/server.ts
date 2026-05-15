import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import { auth } from './middleware/auth';
import { x402Paywall, subscriptionGate, permitGate } from './middleware/paywall';
import chatRouter from './routes/chat';
import uploadRouter from './routes/upload';
import brainsRouter from './routes/brains';
import subscribeRouter from './routes/subscribe';
import openapiRouter from './routes/openapi';

const app = express();
app.use(cors());
app.use(express.json());

// Public endpoints
app.get('/health', (_, res) => res.json({ status: 'ok' }));
app.use('/openapi.json', openapiRouter);
app.use('/brains', brainsRouter);

// Permit routes (Fhenix authorization)
app.post('/permit/import', async (req, res) => {
  const { userAddress, serializedPermit } = req.body;
  if (!userAddress || !serializedPermit) return res.status(400).json({ error: 'userAddress and serializedPermit required' });
  try {
    const { importPermit } = await import('./fhe/permits');
    await importPermit(userAddress, serializedPermit);
    res.json({ ok: true });
  } catch (e: any) {
    res.json({ ok: true, warning: e.message }); // Don't block if CoFHE unavailable
  }
});
app.delete('/permit/revoke', async (req, res) => {
  const { userAddress, permitId } = req.body;
  if (!userAddress) return res.status(400).json({ error: 'userAddress required' });
  try {
    const { revokePermit } = await import('./fhe/permits');
    await revokePermit(userAddress, permitId || '');
    res.json({ ok: true });
  } catch (e: any) {
    res.json({ ok: true });
  }
});

// x402 paywall on subscribe (disabled in dev, enable in production)
app.use('/subscribe', subscribeRouter);

// Subscription-gated endpoints
app.use('/chat', auth, subscriptionGate as any, chatRouter);
app.use('/upload', auth, permitGate as any, subscriptionGate as any, uploadRouter);

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`API listening on :${PORT}`));
