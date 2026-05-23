/**
 * arkiv-shims.d.ts — ambient module declarations for @arkiv-network/sdk.
 *
 * Why this file exists: the api uses TypeScript "node" module resolution
 * for ts-node-dev compatibility, but @arkiv-network/sdk uses the modern
 * `exports` field which "node" resolution doesn't read. These shims tell
 * TypeScript what's at each subpath; Node.js itself reads the exports
 * field at runtime, so the actual modules resolve fine.
 *
 * Trade-off: we lose precise typing for query operators (we keep our own
 * typed wrappers in arkivMemoryService.ts for the parts that matter).
 */

declare module '@arkiv-network/sdk/accounts' {
  // viem 2.x — Arkiv re-exports this verbatim.
  export function privateKeyToAccount(privateKey: `0x${string}`): {
    address: `0x${string}`;
    signMessage(args: { message: string | { raw: `0x${string}` } }): Promise<`0x${string}`>;
    type: 'local' | 'json-rpc';
  };
  export function generatePrivateKey(): `0x${string}`;
}

declare module '@arkiv-network/sdk/chains' {
  // The chain object is passed as a black-box to createPublicClient/createWalletClient.
  export const braga: any;
  export const kaolin: any;
  export const localhost: any;
}

declare module '@arkiv-network/sdk/query' {
  // Predicate / OrderByAttribute are opaque values produced by these factories
  // and consumed by buildQuery().where()/orderBy(). Exact types live inside the SDK.
  export function eq(name: string, value: string | number): any;
  export function neq(name: string, value: string | number): any;
  export function gt(name: string, value: number): any;
  export function gte(name: string, value: number): any;
  export function lt(name: string, value: number): any;
  export function lte(name: string, value: number): any;
  export function and(...preds: any[]): any;
  export function or(...preds: any[]): any;
  export function not(pred: any): any;
  export function asc(name: string, type?: 'string' | 'number'): any;
  export function desc(name: string, type?: 'string' | 'number'): any;
}

declare module '@arkiv-network/sdk/utils' {
  export function stringToPayload(s: string): Uint8Array;
  export function jsonToPayload(obj: unknown): Uint8Array;
  export function payloadToString(p: Uint8Array): string;
  export const ExpirationTime: {
    fromMinutes(n: number): number;
    fromHours(n: number): number;
    fromDays(n: number): number;
  };
}
