import { Router } from 'express';

const router = Router();

const spec = {
  openapi: '3.0.3',
  info: {
    title: 'FHE Second Brain API',
    version: '1.0.0',
    description: 'Private AI Second Brain with FHE-encrypted knowledge. Subscribe via x402, store knowledge, chat with brains.',
  },
  servers: [{ url: process.env.DOMAIN ? `https://${process.env.DOMAIN}` : 'http://localhost:3001' }],
  paths: {
    '/subscribe': {
      post: {
        summary: 'Subscribe (x402 payment)',
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { tier: { type: 'string', enum: ['week', 'month', 'quarter'] } } } } } },
        responses: { '200': { description: 'Subscription created with on-chain tx' } },
      },
    },
    '/chat': {
      post: {
        summary: 'Chat with a brain (store or learn)',
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { message: { type: 'string' }, brainId: { type: 'string', nullable: true }, mode: { type: 'string', enum: ['learn', 'store'] } }, required: ['message'] } } } },
        responses: { '200': { description: 'AI response from brain knowledge' }, '402': { description: 'Subscription required' } },
      },
    },
    '/upload': {
      post: {
        summary: 'Upload encrypted file to brain',
        requestBody: { content: { 'multipart/form-data': { schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' }, keyHigh: { type: 'string' }, keyLow: { type: 'string' }, brainId: { type: 'string' } } } } } },
        responses: { '200': { description: 'Upload queued' } },
      },
    },
    '/brains': { get: { summary: 'List published brains', responses: { '200': { description: 'Array of published brains' } } } },
    '/brains/search': { get: { summary: 'Search brains', parameters: [{ name: 'q', in: 'query', schema: { type: 'string' } }], responses: { '200': { description: 'Search results' } } } },
    '/brains/{id}': { get: { summary: 'Get brain by ID', parameters: [{ name: 'id', in: 'path', schema: { type: 'string' } }], responses: { '200': { description: 'Brain details' } } } },
    '/health': { get: { summary: 'Health check', responses: { '200': { description: 'Service status' } } } },
  },
  components: {
    securitySchemes: {
      wallet: { type: 'apiKey', in: 'header', name: 'x-wallet-address', description: 'User wallet address' },
      chain: { type: 'apiKey', in: 'header', name: 'x-chain', description: 'Chain: base-sepolia | arbitrum-sepolia' },
    },
  },
};

router.get('/', (_, res) => res.json(spec));

export default router;
