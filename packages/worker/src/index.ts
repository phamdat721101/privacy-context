// dotenv with override:true — pm2 caches the env from initial daemon start;
// without override, an out-of-date DATABASE_URL (or any other key) sticks
// across restarts and silently routes the worker to the wrong DB.
import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ override: true });
import { Worker } from 'bullmq';
import { ipfsPinProcessor } from './jobs/ipfs-pin';
import { fileProcessProcessor } from './jobs/file-process';
import { historyArchiveProcessor } from './jobs/history-archive';
import { keyDecryptProcessor } from './jobs/key-decrypt';
import { startChainSync } from './jobs/chain-sync';
import { startChainRelayer } from './jobs/chain-relayer';
import { startAgentHealthCanary } from './jobs/agent-health-canary';
import { startWebhookRetry } from './jobs/webhook-retry';

const connection = { host: process.env.REDIS_HOST || '127.0.0.1', port: +(process.env.REDIS_PORT || 6379) };

new Worker('ipfs-pin', ipfsPinProcessor, { connection });
new Worker('file-process', fileProcessProcessor, { connection });
new Worker('history-archive', historyArchiveProcessor, { connection });
new Worker('key-decrypt', keyDecryptProcessor, { connection });
startChainSync();

// PRD-19 — gasless seller onboarding. Off by default for byte-identical
// rollback. Flip FEATURE_GASLESS_ONBOARD=true after the relayer wallet
// is funded with at least 0.005 ETH on Arbitrum Sepolia.
if (process.env.FEATURE_GASLESS_ONBOARD === 'true') {
  startChainRelayer();
}

// PRD-1 — public-agent health canary. No-op when the flag is off.
startAgentHealthCanary();

// PRD-2 — async-task webhook retry consumer. No-op when the flag is off.
startWebhookRetry();

console.log('[worker] all processors registered');
