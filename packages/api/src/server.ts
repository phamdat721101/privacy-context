import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import { auth } from './middleware/auth';
import { x402Paywall, subscriptionGate } from './middleware/paywall';
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

// Permit routes (backward compat with frontend onboard flow)
app.post('/permit/import', (req, res) => res.json({ ok: true }));
app.delete('/permit/revoke', (req, res) => res.json({ ok: true }));

// x402 paywall on subscribe (disabled in dev, enable in production)
app.use('/subscribe', subscribeRouter);

// Subscription-gated endpoints (DB check, returns 402 challenge if not subscribed)
app.use('/chat', auth, subscriptionGate as any, chatRouter);
app.use('/upload', auth, subscriptionGate as any, uploadRouter);

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`API listening on :${PORT}`));
