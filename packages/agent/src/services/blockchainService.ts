import { ethers } from 'ethers';
import { getContextManagerContract } from '../contracts/AIContextManager';
import { getMemoryStoreContract } from '../contracts/AIMemoryStore';
import type { ContextHandles } from '@fhe-ai-context/sdk';

export interface BlockchainServiceConfig {
  rpcUrl: string;
  agentPrivateKey: string;
  contextManagerAddress: string;
  memoryStoreAddress: string;
}

export class BlockchainService {
  private readonly provider: ethers.JsonRpcProvider;
  private readonly signer: ethers.Wallet;
  private readonly contextManager: ethers.Contract;
  private readonly memoryStore: ethers.Contract;

  constructor(config: BlockchainServiceConfig) {
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl);
    this.signer = new ethers.Wallet(config.agentPrivateKey, this.provider);
    this.contextManager = getContextManagerContract(config.contextManagerAddress, this.signer);
    this.memoryStore = getMemoryStoreContract(config.memoryStoreAddress, this.signer);
  }

  async getContextHandles(userAddress: string): Promise<ContextHandles> {
    const raw = await this.contextManager.getContextHandles(userAddress);
    return {
      sessionKey:     BigInt(raw.sessionKey),
      userId:         BigInt(raw.userId),
      contextVersion: BigInt(raw.contextVersion),
      sentimentScore: BigInt(raw.sentimentScore),
      trustLevel:     BigInt(raw.trustLevel),
      memoryTier:     BigInt(raw.memoryTier),
      isActive:       BigInt(raw.isActive),
      isVerified:     BigInt(raw.isVerified),
      authorizedAgent:BigInt(raw.authorizedAgent),
    };
  }

  async getMemoryHandles(userAddress: string) {
    const raw = await this.memoryStore.getMemoryHandles(userAddress);
    return {
      memoryHash:       BigInt(raw.memoryHash),
      lastInteraction:  BigInt(raw.lastInteraction),
      interactionCount: BigInt(raw.interactionCount),
      memoryTier:       BigInt(raw.memoryTier),
    };
  }

  async updateMemory(
    userAddress: string,
    inMemoryHash: `0x${string}`,
    inLastInteraction: `0x${string}`,
  ) {
    const tx = await this.memoryStore.updateMemory(userAddress, inMemoryHash, inLastInteraction);
    return tx.wait();
  }

  getSignerAddress(): string {
    return this.signer.address;
  }
}

let _service: BlockchainService | null = null;

export function getBlockchainService(): BlockchainService {
  if (!_service) {
    _service = new BlockchainService({
      rpcUrl: process.env.RPC_URL_ARBITRUM_SEPOLIA!,
      agentPrivateKey: process.env.AGENT_PRIVATE_KEY!,
      contextManagerAddress: process.env.CONTEXT_MANAGER_ADDRESS!,
      memoryStoreAddress: process.env.MEMORY_STORE_ADDRESS!,
    });
  }
  return _service;
}
