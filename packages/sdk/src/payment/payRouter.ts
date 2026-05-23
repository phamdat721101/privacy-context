/**
 * payRouter — unified `Pay()` abstraction for the three v3 rails.
 *
 * Design (SOLID):
 *   - `RailAdapter` is the only behaviour interface (ISP).
 *   - `PayRouter` is a thin dispatcher (SRP).
 *   - Each adapter is mock-first; real-prod swap = replace pay() body.
 *   - parse402 is a pure function (no I/O) so it composes everywhere.
 *
 * The MPP spec (Stripe + Tempo, mainnet 2026) reuses HTTP 402 with multiple
 * `WWW-Authenticate: Payment` headers — one per method. So a single 402
 * response can advertise x402 + MPP + sui-usdc simultaneously, and the router
 * picks whichever the buyer's wallet supports + prefers.
 */

// Rail kept local to SDK to avoid cross-package coupling. Mirrors @fhe-brain/shared.
export type Rail = 'x402' | 'mpp' | 'sui_usdc';

export interface RailOffer {
  rail: Rail;
  method: string;          // 'exact' (x402) | 'tempo' (mpp) | 'sui-usdc'
  amount_usdc: string;     // decimal string ("0.01")
  metadata: Record<string, string>;
}

export interface PaymentChallenge {
  rails: RailOffer[];
  endpoint_url: string;    // the original URL that returned 402
  challenge_id?: string;   // server-side correlation id
}

export interface PaymentReceipt {
  rail: Rail;
  tx_or_receipt: string;
  amount_usdc: string;
  ts: number;
  mock?: boolean;
}

export interface PayOptions {
  walletAddress: string;
  /** Dev-only signer; production callers pass a wallet adapter instead. */
  privateKey?: string;
  /** MPP secret key handle (KMS-backed in prod). */
  mppSecretKeyId?: string;
}

export interface WalletPrefs {
  preferredRail?: Rail;
  hasEvmWallet?: boolean;
  hasSuiWallet?: boolean;
  hasMppFunds?: boolean;
}

export interface RailAdapter {
  readonly rail: Rail;
  pay(offer: RailOffer, ctx: { challenge: PaymentChallenge; opts: PayOptions }): Promise<PaymentReceipt>;
}

// ---------------------------------------------------------------------------
// Parser — consumes a fetch Response (or its headers) and returns a challenge.
// ---------------------------------------------------------------------------

/**
 * Parse the WWW-Authenticate headers of a 402 response into a {@link PaymentChallenge}.
 * Defensive against missing/malformed headers; returns rails: [] on no match.
 */
export function parse402(response: { headers: Headers; url: string; status: number }): PaymentChallenge | null {
  if (response.status !== 402) return null;
  const raw = response.headers.get('www-authenticate') ?? '';
  // Multi-WWW-Authenticate: most fetch impls collapse with comma; per RFC each starts with `Payment `.
  const parts = raw.split(/,\s*(?=Payment\b)/g).filter((p) => p.startsWith('Payment'));
  const rails: RailOffer[] = [];
  for (const part of parts) {
    const params = parseAuthParams(part);
    const rail = methodToRail(params.method);
    if (!rail) continue;
    rails.push({
      rail,
      method: params.method ?? '',
      amount_usdc: params.amount ?? '0',
      metadata: params,
    });
  }
  return { rails, endpoint_url: response.url, challenge_id: rails[0]?.metadata.id };
}

function parseAuthParams(headerSegment: string): Record<string, string> {
  // "Payment id=\"abc\", method=\"tempo\", amount=\"0.01\"" — naive but spec-shaped.
  const out: Record<string, string> = {};
  const body = headerSegment.replace(/^Payment\s*/, '');
  const re = /(\w+)\s*=\s*("([^"]*)"|([^,]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    out[m[1]] = (m[3] ?? m[4] ?? '').trim();
  }
  return out;
}

function methodToRail(method?: string): Rail | null {
  if (!method) return null;
  const m = method.toLowerCase();
  if (m === 'x402' || m === 'exact') return 'x402';
  if (m === 'tempo' || m === 'mpp') return 'mpp';
  if (m === 'sui-usdc' || m === 'sui_usdc') return 'sui_usdc';
  return null;
}

// ---------------------------------------------------------------------------
// Mock-first adapters. Each emits a deterministic receipt with mock:true so
// the UI can show a "live-mock" badge — never lies about prod-readiness.
// ---------------------------------------------------------------------------

const mockReceipt = (rail: Rail, offer: RailOffer): PaymentReceipt => ({
  rail,
  tx_or_receipt: `mock-${rail}-${Date.now().toString(16)}`,
  amount_usdc: offer.amount_usdc,
  ts: Date.now(),
  mock: true,
});

export const x402Adapter: RailAdapter = {
  rail: 'x402',
  async pay(offer) {
    // Real-prod swap: call n-payment SDK fetchWithPayment and capture the receipt.
    // For v1 we emit a mock receipt synchronously; the gateway treats `mock:true`
    // as paid in dev/sandbox mode only.
    return mockReceipt('x402', offer);
  },
};

export const mppAdapter: RailAdapter = {
  rail: 'mpp',
  async pay(offer) {
    // Real-prod swap: `mppx/server` Mppx.compose flow. v1: deterministic mock.
    return mockReceipt('mpp', offer);
  },
};

export const suiUsdcAdapter: RailAdapter = {
  rail: 'sui_usdc',
  async pay(offer) {
    // Real-prod swap: build sponsored Sui tx calling `agent_billing::pay_per_call`,
    // sign with the buyer's Sui wallet, broadcast via SuiClient, return digest.
    return mockReceipt('sui_usdc', offer);
  },
};

// ---------------------------------------------------------------------------
// Router — composition root.
// ---------------------------------------------------------------------------

export class PayRouter {
  private adapters: Record<Rail, RailAdapter>;
  constructor(adapters?: Partial<Record<Rail, RailAdapter>>) {
    this.adapters = {
      x402: adapters?.x402 ?? x402Adapter,
      mpp: adapters?.mpp ?? mppAdapter,
      sui_usdc: adapters?.sui_usdc ?? suiUsdcAdapter,
    };
  }

  /**
   * Pick the best available rail. Order:
   *   1. `prefs.preferredRail` if it's offered
   *   2. cheapest rail the wallet has capability for
   *   3. first rail offered (caller may still reject)
   */
  selectRail(challenge: PaymentChallenge, prefs: WalletPrefs = {}): Rail {
    if (challenge.rails.length === 0) {
      throw new Error('payRouter:no-rails-offered');
    }
    if (prefs.preferredRail && challenge.rails.some((r) => r.rail === prefs.preferredRail)) {
      return prefs.preferredRail;
    }
    const capable = challenge.rails.filter((r) => this.walletCanUse(r.rail, prefs));
    const ranked = (capable.length ? capable : challenge.rails)
      .slice()
      .sort((a, b) => Number(a.amount_usdc) - Number(b.amount_usdc));
    return ranked[0].rail;
  }

  async pay(challenge: PaymentChallenge, rail: Rail, opts: PayOptions): Promise<PaymentReceipt> {
    const offer = challenge.rails.find((r) => r.rail === rail);
    if (!offer) throw new Error(`payRouter:rail-not-offered:${rail}`);
    const adapter = this.adapters[rail];
    return adapter.pay(offer, { challenge, opts });
  }

  private walletCanUse(rail: Rail, prefs: WalletPrefs): boolean {
    if (rail === 'x402') return prefs.hasEvmWallet ?? true;
    if (rail === 'mpp') return prefs.hasMppFunds ?? prefs.hasEvmWallet ?? true;
    if (rail === 'sui_usdc') return prefs.hasSuiWallet ?? false;
    return false;
  }
}
