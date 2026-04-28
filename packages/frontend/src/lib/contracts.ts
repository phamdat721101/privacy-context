import ContextManagerAbi from './abis/AIContextManager.json';
import MemoryStoreAbi from './abis/AIMemoryStore.json';
import AgentRegistryAbi from './abis/AgentRegistry.json';
import SkillRegistryAbi from './abis/SkillRegistry.json';
import SkillVaultAbi from './abis/AgentSkillVault.json';
import SkillAccessControllerAbi from './abis/SkillAccessController.json';
import PaymentTokenAbi from './abis/EncryptedPaymentToken.json';
import PrivPayGatewayAbi from './abis/PrivPayGateway.json';

export const CONTEXT_MANAGER_ADDRESS =
  (process.env.NEXT_PUBLIC_CONTEXT_MANAGER_ADDRESS ?? '') as `0x${string}`;

export const MEMORY_STORE_ADDRESS =
  (process.env.NEXT_PUBLIC_MEMORY_STORE_ADDRESS ?? '') as `0x${string}`;

export const AGENT_REGISTRY_ADDRESS =
  (process.env.NEXT_PUBLIC_AGENT_REGISTRY_ADDRESS ?? '') as `0x${string}`;

export const AGENT_ADDRESS =
  (process.env.NEXT_PUBLIC_AGENT_ADDRESS ?? '') as `0x${string}`;

export const AGENT_BACKEND_URL =
  process.env.NEXT_PUBLIC_AGENT_BACKEND_URL ?? 'http://localhost:3001';

export const SKILL_REGISTRY_ADDRESS =
  (process.env.NEXT_PUBLIC_SKILL_REGISTRY_ADDRESS ?? '') as `0x${string}`;

export const SKILL_VAULT_ADDRESS =
  (process.env.NEXT_PUBLIC_SKILL_VAULT_ADDRESS ?? '') as `0x${string}`;

export const SKILL_ACCESS_CONTROLLER_ADDRESS =
  (process.env.NEXT_PUBLIC_SKILL_ACCESS_CONTROLLER_ADDRESS ?? '') as `0x${string}`;

export const PAYMENT_TOKEN_ADDRESS =
  (process.env.NEXT_PUBLIC_PAYMENT_TOKEN_ADDRESS ?? '') as `0x${string}`;

export const PRIVPAY_GATEWAY_ADDRESS =
  (process.env.NEXT_PUBLIC_PRIVPAY_GATEWAY_ADDRESS ?? '') as `0x${string}`;

export { ContextManagerAbi, MemoryStoreAbi, AgentRegistryAbi, SkillRegistryAbi, SkillVaultAbi, SkillAccessControllerAbi, PaymentTokenAbi, PrivPayGatewayAbi };
