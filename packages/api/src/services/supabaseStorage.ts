/**
 * supabaseStorage.ts — encrypted-blob hosting for OpenX brains.
 *
 * Replaces the Walrus + Tatum pipeline. Stores AES-256-GCM ciphertext
 * (encryption happens client-side; the server never sees plaintext) in a
 * Supabase Storage bucket. Returns a self-describing URI of the form
 * `supabase://<bucket>/<path>` that callers persist in `brains.payload_uri`.
 *
 * SOLID:
 *   • SRP   — blob upload / download / signed-URL only. No knowledge of
 *             brains, encryption, or auth.
 *   • DIP   — `SupabaseClient` is constructor-injected; tests pass a stub.
 *   • OCP   — adding presigned-write or multipart simply adds a method.
 *
 * Env (read by `getSupabaseStorage()` only — direct construction is keyless):
 *   SUPABASE_URL                 https://<project-ref>.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY    server-only key with bucket-write scope
 *   SUPABASE_STORAGE_BUCKET      defaults to 'brain-blobs'
 */

import type { Logger } from 'pino';

/**
 * Structural type for the bits of `SupabaseClient` we use. This lets the
 * service compile before `@supabase/supabase-js` is installed; the runtime
 * `require()` call below pulls the real client at first use.
 */
interface SupabaseClientLike {
  storage: {
    from(bucket: string): {
      upload(
        path: string,
        body: Buffer | Uint8Array | Blob,
        opts?: { contentType?: string; upsert?: boolean },
      ): Promise<{ data: unknown; error: { message: string } | null }>;
      download(path: string): Promise<{
        data: { arrayBuffer(): Promise<ArrayBuffer> } | null;
        error: { message: string } | null;
      }>;
      createSignedUrl(
        path: string,
        ttlSec: number,
      ): Promise<{ data: { signedUrl: string } | null; error: { message: string } | null }>;
    };
  };
}

const URI_PREFIX = 'supabase://';

export interface SupabaseStorageDeps {
  client: SupabaseClientLike;
  bucket: string;
  logger?: Pick<Logger, 'info' | 'warn' | 'error'>;
}

export class SupabaseStorage {
  constructor(private readonly deps: SupabaseStorageDeps) {}

  /** Parse a `supabase://<bucket>/<path>` URI; throws on malformed input. */
  static parseUri(uri: string): { bucket: string; path: string } {
    if (!uri.startsWith(URI_PREFIX)) {
      throw new Error(`invalid supabase URI: ${uri}`);
    }
    const tail = uri.slice(URI_PREFIX.length);
    const slash = tail.indexOf('/');
    if (slash <= 0) throw new Error(`invalid supabase URI: ${uri}`);
    return { bucket: tail.slice(0, slash), path: tail.slice(slash + 1) };
  }

  /** Compose a self-describing URI for a path inside this storage's bucket. */
  toUri(path: string): string {
    return `${URI_PREFIX}${this.deps.bucket}/${path}`;
  }

  /**
   * Upload a ciphertext blob. Idempotent on `path` (upsert: true).
   * Caller is responsible for encryption; we store bytes verbatim.
   */
  async upload(
    buf: Buffer,
    path: string,
    contentType = 'application/octet-stream',
  ): Promise<string> {
    const { error } = await this.deps.client.storage
      .from(this.deps.bucket)
      .upload(path, buf, { contentType, upsert: true });
    if (error) throw new Error(`supabase upload failed: ${error.message}`);
    this.deps.logger?.info({ path, bytes: buf.length }, 'supabase:upload');
    return this.toUri(path);
  }

  /** Download a ciphertext blob by URI. */
  async download(uri: string): Promise<Buffer> {
    const { bucket, path } = SupabaseStorage.parseUri(uri);
    const { data, error } = await this.deps.client.storage
      .from(bucket)
      .download(path);
    if (error || !data) {
      throw new Error(`supabase download failed: ${error?.message ?? 'no data'}`);
    }
    return Buffer.from(await data.arrayBuffer());
  }

  /**
   * Issue a time-bound signed URL for a blob. Default TTL 15 minutes.
   * Caller fetches the URL directly; we never proxy bytes.
   */
  async signedUrl(uri: string, ttlSec = 900): Promise<string> {
    const { bucket, path } = SupabaseStorage.parseUri(uri);
    const { data, error } = await this.deps.client.storage
      .from(bucket)
      .createSignedUrl(path, ttlSec);
    if (error || !data) {
      throw new Error(`supabase signed-url failed: ${error?.message ?? 'no url'}`);
    }
    return data.signedUrl;
  }
}

let _singleton: SupabaseStorage | null = null;

/**
 * Lazy-construct a singleton from env. Throws when SUPABASE_URL or
 * SUPABASE_SERVICE_ROLE_KEY are unset — the API boot env-validator should
 * catch that, but we double-check here so a misconfigured deploy fails
 * loudly on the first publish rather than silently breaking storage.
 */
export function getSupabaseStorage(): SupabaseStorage {
  if (_singleton) return _singleton;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? 'brain-blobs';
  if (!url || !key) {
    throw new Error(
      'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set for blob storage',
    );
  }
  // Lazy require so tests / consumers without storage needs don't pull the
  // ~1 MB @supabase/supabase-js bundle on import.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createClient } = require('@supabase/supabase-js');
  _singleton = new SupabaseStorage({
    client: createClient(url, key),
    bucket,
  });
  return _singleton;
}
