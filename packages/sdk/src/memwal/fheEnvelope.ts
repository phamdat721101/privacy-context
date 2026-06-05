/**
 * memwal/fheEnvelope.ts — implementation of `FheEnvelope` (PRD-07).
 *
 * Two cryptographic primitives, one trust boundary:
 *   1. Per-namespace **orthogonal matrix** R — HKDF(seed=ownerSuiAddress||namespace).
 *      Multiplying a 1536-dim embedding by R preserves cosine distance
 *      (rotations are isometries) so MemWal's pgvector ANN search still
 *      works on `R · v`. Without R, an adversary with the blinded vector
 *      cannot invert it back to the source embedding.
 *   2. AES-256-GCM at the wire layer with a key wrapped under CoFHE.
 *      The buyer's wallet authorises decryption via an FHE permit; the
 *      operator (OpenX) holds the AES ciphertext but cannot derive the
 *      key without the on-chain permit.
 *
 * IMPORTANT — Phase 4 honesty:
 *   This module ships the *envelope shape* + the deterministic blinded-vector
 *   math. Real CoFHE compute over Walrus blobs (vector operations on FHE
 *   ciphertext) is a Phase 5 deliverable; for now `wrap`/`unwrap` use
 *   AES-256-GCM with a per-namespace key derived from the same HKDF seed.
 *   The trust model is unchanged when `FHE_MEMWAL_ENABLE=false` (envelope
 *   is bypassed entirely). When the flag is true, the envelope adds a
 *   second encryption layer above MemWal's existing Seal — even a hostile
 *   relayer sees only doubly-encrypted ciphertext + a blinded vector.
 *
 * SOLID:
 *  - SRP: one factory, no I/O. Pure crypto math.
 *  - DIP: returns a `FheEnvelope` (interface lives in types.ts). The
 *    adapter consumes the interface; switching to a real CoFHE backend
 *    later = swap this file's factory output.
 */

import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { FheEnvelope } from './types';

/** 1536-dim vector size (matches MemWal's text-embedding-3-small dim). */
const VECTOR_DIM = 1536;
const KEY_BYTES = 32;
const NONCE_BYTES = 12;

interface FheEnvelopeConfig {
  /** Sui address of the namespace owner (HKDF salt input). */
  ownerSuiAddress: string;
  /** Master secret used as the HKDF input. Must NOT be persisted in plaintext. */
  masterSecret: string;
}

/**
 * Build an FheEnvelope bound to one owner. The same (ownerSuiAddress,
 * masterSecret, namespace) triple always derives the same R + key — that
 * keeps `restore` semantics intact across deployments.
 */
export function createFheEnvelope(cfg: FheEnvelopeConfig): FheEnvelope {
  const masterBytes = new TextEncoder().encode(cfg.masterSecret);
  const ownerBytes = new TextEncoder().encode(cfg.ownerSuiAddress.toLowerCase());

  const matrixCache = new Map<string, Float32Array>();
  const aesKeyCache = new Map<string, Buffer>();

  function deriveBytes(namespace: string, info: string, len: number): Uint8Array {
    return hkdf(sha256, masterBytes, ownerBytes, new TextEncoder().encode(`${namespace}:${info}`), len);
  }

  function rotationMatrix(namespace: string): Float32Array {
    const cached = matrixCache.get(namespace);
    if (cached) return cached;
    // Householder reflection — single random vector u, R = I − 2 (u u^T) / (u^T u).
    // Cosine-distance-preserving (orthogonal); cheap to compute (no QR needed).
    // Storing the full 1536x1536 matrix is wasteful; we keep `u` and apply
    // R · v lazily as v − 2(u·v)·u/|u|^2.
    const u = deriveBytes(namespace, 'matrix', VECTOR_DIM * 4);
    const v = new Float32Array(VECTOR_DIM);
    for (let i = 0; i < VECTOR_DIM; i++) {
      // Map 4 bytes to a float in [-1, 1]
      const bi = i * 4;
      const n = (u[bi] << 24) | (u[bi + 1] << 16) | (u[bi + 2] << 8) | u[bi + 3];
      v[i] = ((n | 0) / 2147483647);
    }
    matrixCache.set(namespace, v);
    return v;
  }

  function applyRotation(v: number[] | Float32Array, namespace: string): number[] {
    const u = rotationMatrix(namespace);
    let dot = 0;
    let unorm = 0;
    for (let i = 0; i < VECTOR_DIM; i++) {
      dot += v[i] * u[i];
      unorm += u[i] * u[i];
    }
    const k = (2 * dot) / (unorm || 1);
    const out = new Array<number>(VECTOR_DIM);
    for (let i = 0; i < VECTOR_DIM; i++) out[i] = v[i] - k * u[i];
    return out;
  }

  function aesKey(namespace: string): Buffer {
    const cached = aesKeyCache.get(namespace);
    if (cached) return cached;
    const k = Buffer.from(deriveBytes(namespace, 'aes', KEY_BYTES));
    aesKeyCache.set(namespace, k);
    return k;
  }

  return {
    async ensureNamespaceKey(namespace) {
      const matrix = rotationMatrix(namespace);
      // Hash of the rotation seed — surface for audit logs (no plaintext leaks).
      const matrixHash = Buffer.from(sha256(new Uint8Array(matrix.buffer))).toString('hex').slice(0, 32);
      return {
        keypairId: `cofhe-stub:${cfg.ownerSuiAddress.toLowerCase()}:${namespace}`,
        orthogonalMatrixHash: matrixHash,
      };
    },

    async wrap(text, namespace) {
      const key = aesKey(namespace);
      const nonce = randomBytes(NONCE_BYTES);
      const cipher = createCipheriv('aes-256-gcm', key, nonce);
      const ct = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
      const tag = cipher.getAuthTag();
      // Layout: nonce(12) || tag(16) || ciphertext
      const ciphertext = new Uint8Array(NONCE_BYTES + 16 + ct.length);
      ciphertext.set(nonce, 0);
      ciphertext.set(tag, NONCE_BYTES);
      ciphertext.set(ct, NONCE_BYTES + 16);

      // Build a deterministic 1536-dim "embedding" from the plaintext digest.
      // The vector is namespace-bound so different namespaces produce
      // distinct base vectors before rotation — cosine distance ACROSS
      // namespaces is meaningful (privacy via separation), while WITHIN a
      // namespace it stays preserved (same text → same blinded vector).
      const baseVec = digestToVector(text, namespace);
      const blinded = applyRotation(baseVec, namespace);

      return {
        ciphertext,
        blindedVector: blinded,
        cofheAttestation: 'stub-no-cofhe-tx',
      };
    },

    async unwrap(ciphertext, namespace) {
      const key = aesKey(namespace);
      const nonce = ciphertext.slice(0, NONCE_BYTES);
      const tag = ciphertext.slice(NONCE_BYTES, NONCE_BYTES + 16);
      const ct = ciphertext.slice(NONCE_BYTES + 16);
      const decipher = createDecipheriv('aes-256-gcm', key, nonce);
      decipher.setAuthTag(Buffer.from(tag));
      const out = Buffer.concat([decipher.update(Buffer.from(ct)), decipher.final()]);
      return out.toString('utf8');
    },

    async blindQuery(query, namespace) {
      const baseVec = digestToVector(query, namespace);
      return applyRotation(baseVec, namespace);
    },

    async issuePermit(namespace, buyerWallet, expirySeconds) {
      // Stub permit format: HMAC over (namespace, buyer, expiry) using master.
      // Real impl returns a CoFHE-circuit-signed permit; format-compatible.
      const exp = Math.floor(Date.now() / 1000) + expirySeconds;
      const permit = sha256(
        new TextEncoder().encode(
          `${namespace}:${buyerWallet.toLowerCase()}:${exp}:${cfg.masterSecret}`,
        ),
      );
      return `${exp}.${Buffer.from(permit).toString('hex').slice(0, 48)}`;
    },
  };
}

/**
 * Map an arbitrary string to a deterministic VECTOR_DIM-dim Float32 vector
 * derived from its SHA-256 digest, salted by namespace. This is a placeholder
 * for a real embedding pipeline; the FHE envelope only needs *some* vector
 * that the blinded form can be compared against on recall.
 */
function digestToVector(text: string, namespace: string): Float32Array {
  const v = new Float32Array(VECTOR_DIM);
  let chunk = 0;
  const seed = `${namespace}:`;
  let buf = sha256(new TextEncoder().encode(`${seed}chunk-${chunk}:${text}`));
  let i = 0;
  while (i < VECTOR_DIM) {
    if (i % 32 === 0 && i > 0) {
      chunk += 1;
      buf = sha256(new TextEncoder().encode(`${seed}chunk-${chunk}:${text}`));
    }
    const b = buf[i % 32];
    v[i] = (b - 128) / 128;
    i++;
  }
  return v;
}

/** Helper for tests + smoke — cosine distance between two equal-length vectors. */
export function cosineDistance(a: number[] | Float32Array, b: number[] | Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 1;
  return 1 - dot / (Math.sqrt(na) * Math.sqrt(nb));
}
