export type ChainId = 'base-sepolia' | 'arbitrum-sepolia';

export const CHAINS: Record<ChainId, { id: number; rpc: string }> = {
  'base-sepolia': { id: 84532, rpc: process.env.BASE_SEPOLIA_RPC || 'https://sepolia.base.org' },
  'arbitrum-sepolia': { id: 421614, rpc: process.env.ARBITRUM_SEPOLIA_RPC || 'https://sepolia-rollup.arbitrum.io/rpc' },
};

export const CONTRACTS: Record<ChainId, { subscriptionController: string; knowledgeBaseRegistry: string; brainKeyVault: string }> = {
  'base-sepolia': {
    subscriptionController: process.env.SUBSCRIPTION_CONTROLLER_ADDRESS || '0x0000000000000000000000000000000000000000',
    knowledgeBaseRegistry: process.env.KNOWLEDGE_REGISTRY_ADDRESS || '0x0000000000000000000000000000000000000000',
    brainKeyVault: process.env.BRAIN_KEY_VAULT_ADDRESS || '0x0000000000000000000000000000000000000000',
  },
  'arbitrum-sepolia': {
    subscriptionController: process.env.SUBSCRIPTION_CONTROLLER_ADDRESS || '0xCC42779858F1cd3F480aD33BcBc5A931D57DfFc3',
    knowledgeBaseRegistry: process.env.KNOWLEDGE_REGISTRY_ADDRESS || '0x36eca600679E73061318f8C10F6E43aFc06C96E0',
    brainKeyVault: process.env.BRAIN_KEY_VAULT_ADDRESS || '0x07beFe30F0C8Ef8B4c513da22A310eF84E9010c0',
  },
};

export const SubscriptionControllerABI = [
  'function subscribe(address user, uint8 tier, uint64 expiry) external',
  'function checkAccess(address user) view returns (bytes32)',
  'function getTier(address user) view returns (bytes32)',
  'event Subscribed(address indexed user, uint8 tier)',
] as const;

export const KnowledgeBaseRegistryABI = [
  'function createBrain(tuple(bytes32 hash, uint8 utype, int32 securityZone, bytes signature) merkleRoot) returns (uint256)',
  'function addChunk(uint256 brainId, tuple(bytes32 hash, uint8 utype, int32 securityZone, bytes signature) chunkHash)',
  'function publish(uint256 brainId)',
  'function unpublish(uint256 brainId)',
  'function getBrainCount() view returns (uint256)',
  'function isBrainPublished(uint256 brainId) view returns (bool)',
  'event BrainCreated(uint256 indexed id, address indexed owner)',
  'event BrainPublished(uint256 indexed id)',
  'event ChunkAdded(uint256 indexed brainId, uint32 chunkIndex)',
] as const;

export const BrainKeyVaultABI = [
  'function storeKey(uint256 brainId, tuple(bytes32 hash, uint8 utype, int32 securityZone, bytes signature) high, tuple(bytes32 hash, uint8 utype, int32 securityZone, bytes signature) low)',
  'function getKeyHandles(uint256 brainId) view returns (bytes32 high, bytes32 low)',
  'function brainOwner(uint256 brainId) view returns (address)',
  'function setPlatform(address _platform)',
  'event KeyStored(uint256 indexed brainId, address indexed brainOwnerAddr)',
] as const;
