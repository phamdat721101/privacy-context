import { getCofheClient } from './client';

// In-memory permit store: userAddress → permit object
const permits = new Map<string, any>();

export async function importPermit(userAddress: string, serializedPermit: string): Promise<void> {
  const client = await getCofheClient();
  const permit = await client.permits.importShared(serializedPermit);
  permits.set(userAddress.toLowerCase(), permit);
}

export async function revokePermit(userAddress: string, permitId: string): Promise<void> {
  const client = await getCofheClient();
  client.permits.removePermit(permitId);
  permits.delete(userAddress.toLowerCase());
}

export function hasPermit(userAddress: string): boolean {
  return permits.has(userAddress.toLowerCase());
}

export function getPermit(userAddress: string): any | null {
  return permits.get(userAddress.toLowerCase()) || null;
}
