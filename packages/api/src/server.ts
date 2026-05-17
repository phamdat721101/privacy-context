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
app.get('/platform', (_, res) => res.json({
  platformWallet: process.env.PLATFORM_WALLET || '',
  contracts: {
    subscriptionController: process.env.SUBSCRIPTION_CONTROLLER_ADDRESS,
    knowledgeRegistry: process.env.KNOWLEDGE_REGISTRY_ADDRESS,
    brainKeyVault: process.env.BRAIN_KEY_VAULT_ADDRESS,
  },
}));
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
  const { userAddress } = req.body;
  if (!userAddress) return res.status(400).json({ error: 'userAddress required' });
  try {
    const { revokePermit } = await import('./fhe/permits');
    await revokePermit(userAddress);
    res.json({ ok: true });
  } catch (e: any) {
    res.json({ ok: true });
  }
});

// x402 paywall on subscribe (disabled in dev, enable in production)
app.use('/subscribe', subscribeRouter);

// Permit + subscription-gated endpoints
// Permit is required everywhere user knowledge is touched.
app.use('/chat', auth, permitGate as any, subscriptionGate as any, chatRouter);
app.use('/upload', auth, permitGate as any, subscriptionGate as any, uploadRouter);

// Lightweight server-authoritative permit status (used by frontend to
// reconcile cached state with on-chain truth). Returns {authorized, reason}
// so the UI can surface diagnostic guidance instead of a generic dead-end.
app.get('/permit/status', async (req, res) => {
  const address = (req.query.address as string | undefined)?.toLowerCase();
  if (!address) return res.status(400).json({ error: 'address required' });
  try {
    const { hasPermit } = await import('./fhe/permits');
    const status = await hasPermit(address);
    res.json(status);
  } catch {
    res.json({ authorized: false, reason: 'rpc_error' });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`API listening on :${PORT}`));
