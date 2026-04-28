import { FheTypes } from '@cofhe/sdk';
import type { InvoiceHandles, DecryptedInvoice, SubscriptionHandles, DecryptedSubscription } from './paymentTypes';
import { getCofheClient } from '../client/cofheClient';

export async function decryptInvoice(
  handles: InvoiceHandles, permit: unknown,
): Promise<DecryptedInvoice> {
  const client = getCofheClient();
  const p = permit as any;
  const results = await Promise.all([
    client.decryptHandle(handles.amount, FheTypes.Uint64).setPermit(p).decrypt(),
    client.decryptHandle(handles.isPaid, FheTypes.Bool).setPermit(p).decrypt(),
  ]);
  for (const r of results) {
    if (!r.success) throw new Error(`Decryption failed: ${r.error.message}`);
  }
  return {
    amount: BigInt(results[0].data as bigint),
    isPaid: Boolean(results[1].data),
    expiry: handles.expiry,
    creator: handles.creator,
  };
}

export async function decryptSubscription(
  handles: SubscriptionHandles, permit: unknown,
): Promise<DecryptedSubscription> {
  const client = getCofheClient();
  const p = permit as any;
  const results = await Promise.all([
    client.decryptHandle(handles.amount, FheTypes.Uint64).setPermit(p).decrypt(),
    client.decryptHandle(handles.active, FheTypes.Bool).setPermit(p).decrypt(),
  ]);
  for (const r of results) {
    if (!r.success) throw new Error(`Decryption failed: ${r.error.message}`);
  }
  return {
    amount: BigInt(results[0].data as bigint),
    isActive: Boolean(results[1].data),
    interval: handles.interval,
    lastCharged: handles.lastCharged,
    subscriber: handles.subscriber,
  };
}
