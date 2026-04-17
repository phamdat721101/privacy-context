import { FheTypes } from '@cofhe/sdk';
import type { SkillHandles, DecryptedSkill, LicenseHandles, DecryptedLicense } from './skillTypes';
import { getCofheClient } from '../client/cofheClient';

export async function decryptSkillHandles(
  handles: SkillHandles,
  permit: unknown,
): Promise<DecryptedSkill> {
  const client = getCofheClient();
  const p = permit as any;

  const results = await Promise.all([
    client.decryptHandle(handles.skillId,     FheTypes.Uint32).setPermit(p).decrypt(),
    client.decryptHandle(handles.basePrice,   FheTypes.Uint64).setPermit(p).decrypt(),
    client.decryptHandle(handles.maxSupply,   FheTypes.Uint32).setPermit(p).decrypt(),
    client.decryptHandle(handles.activeUsers, FheTypes.Uint32).setPermit(p).decrypt(),
    client.decryptHandle(handles.isActive,    FheTypes.Bool).setPermit(p).decrypt(),
  ]);

  for (const r of results) {
    if (!r.success) throw new Error(`Decryption failed: ${r.error.message}`);
  }

  return {
    skillId:     Number(results[0].data as bigint),
    basePrice:   BigInt(results[1].data as bigint),
    maxSupply:   Number(results[2].data as bigint),
    activeUsers: Number(results[3].data as bigint),
    isActive:    Boolean(results[4].data),
  };
}

export async function decryptLicenseHandles(
  handles: LicenseHandles,
  permit: unknown,
): Promise<DecryptedLicense> {
  const client = getCofheClient();
  const p = permit as any;

  const results = await Promise.all([
    client.decryptHandle(handles.purchasePrice, FheTypes.Uint64).setPermit(p).decrypt(),
    client.decryptHandle(handles.isValid,       FheTypes.Bool).setPermit(p).decrypt(),
  ]);

  for (const r of results) {
    if (!r.success) throw new Error(`Decryption failed: ${r.error.message}`);
  }

  return {
    purchasePrice: BigInt(results[0].data as bigint),
    isValid:       Boolean(results[1].data),
    purchasedAt:   handles.purchasedAt,
    expiresAt:     handles.expiresAt,
  };
}
