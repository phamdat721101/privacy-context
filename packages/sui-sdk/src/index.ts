import { registerBrainProvider, type BrainClientOptions } from '@fhe-ai-context/sdk';
import { SealBrainClient } from './SealBrainClient';

export { SealBrainClient };
export * from './storage/walrusStore';
export * from './storage/walrusQuiltBatcher';
export * from './seal/sealKeyClient';
export * from './inference/phalaTeeInference';

/** Direct factory for callers who want the concrete class without the registry indirection. */
export function createSealBrainClient(opts: BrainClientOptions): SealBrainClient {
  return new SealBrainClient(opts);
}

/**
 * Side-effect on import: register `'sui'` with the SDK's provider registry so
 * consumers can do `createBrainClient('sui', { ... })` from `@fhe-ai-context/sdk`.
 *
 * SOLID — Open/Closed: this is the only place the SDK's factory needs to learn
 * about Sui. The SDK source remains untouched.
 */
registerBrainProvider('sui', createSealBrainClient);
