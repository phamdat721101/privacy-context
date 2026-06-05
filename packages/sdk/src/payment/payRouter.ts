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
export type Rail = 'x402' | 'mpp' | 'sui_usdc' | 'fherc20';

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
  if (m === 'fherc20') return 'fherc20';
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
  async pay(offer, { challenge, opts }): Promise<PaymentReceipt> {
    // Real-prod path: delegate to n-payment's fetchWithPayment. Falls back to
    // a deterministic mock receipt when the SDK isn't installed (tests/CI).
    try {
      // Indirect import — keeps `n-payment` an optional peer at SDK build time
      // (frontend/api install it; the SDK itself does not depend on it).
      const moduleName = 'n-payment';
      const np: any = await import(/* @vite-ignore */ /* webpackIgnore: true */ moduleName).catch(() => null);
      if (np?.createPaymentClient && opts.privateKey) {
        const client = np.createPaymentClient({
          chains: [offer.metadata.network ?? 'arbitrum-sepolia'],
          wallet: { privateKey: opts.privateKey },
        });
        const r = await client.fetchWithPayment(challenge.endpoint_url);
        const txHash = r.headers?.get?.('X-PAYMENT-RESPONSE') ?? `np-${Date.now().toString(16)}`;
        return { rail: 'x402', tx_or_receipt: txHash, amount_usdc: offer.amount_usdc, ts: Date.now() };
      }
    } catch {/* fall through to mock */}
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
  async pay(offer): Promise<PaymentReceipt> {
    // Real-prod path: build a programmable transaction calling
    // `subscription_policy::subscribe<USDC>` with `duration_ms = 60_000` (60-sec
    // pay-per-call window). The resulting `Subscription` object id is the
    // proof handed to SEAL via `seal_approve_pay_per_call`.
    //
    // The @mysten/sui SDK is a peer dep — when not installed we fall through
    // to a deterministic mock receipt (mock:true) so the payment surface
    // stays exercisable in CI and offline dev.
    try {
      const moduleName = '@mysten/sui/client';
      const moduleTx = '@mysten/sui/transactions';
      const moduleKp = '@mysten/sui/keypairs/ed25519';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sdk: any = await Promise.all([
        import(/* @vite-ignore */ /* webpackIgnore: true */ moduleName).catch(() => null),
        import(/* @vite-ignore */ /* webpackIgnore: true */ moduleTx).catch(() => null),
        import(/* @vite-ignore */ /* webpackIgnore: true */ moduleKp).catch(() => null),
      ]);
      const [client, tx, kp] = sdk;
      const packageId = process.env.OPENX_BRAIN_PACKAGE_ID;
      const policyId = offer.metadata.policy_object_id;
      const usdcCoinType = process.env.OPENX_USDC_COIN_TYPE;
      const privateKey = (offer.metadata.private_key ?? process.env.SUI_PAYER_PRIVATE_KEY) as
        | string
        | undefined;
      if (!client || !tx || !kp || !packageId || !policyId || !usdcCoinType || !privateKey) {
        return mockReceipt('sui_usdc', offer);
      }
      const suiClient = new client.SuiClient({
        url: process.env.SUI_RPC_URL ?? 'https://sui-mainnet.gateway.tatum.io',
        headers: process.env.TATUM_API_KEY ? { 'x-api-key': process.env.TATUM_API_KEY } : undefined,
      });
      const keypair = kp.Ed25519Keypair.fromSecretKey(privateKey);
      const txb = new tx.Transaction();
      // Caller must split a Coin<USDC> for `price_mist` — assume offer carries
      // it as `coin_object_id`. If not, we let the user split here.
      const [paymentCoin] = offer.metadata.coin_object_id
        ? [txb.object(offer.metadata.coin_object_id)]
        : txb.splitCoins(txb.gas, [txb.pure.u64(BigInt(offer.metadata.price_mist ?? 0))]);
      const clockId = '0x6'; // Sui mainnet system clock
      const sub = txb.moveCall({
        target: `${packageId}::subscription_policy::subscribe`,
        typeArguments: [usdcCoinType],
        arguments: [txb.object(policyId), paymentCoin, txb.object(clockId)],
      });
      // Transfer the freshly-minted Subscription to the payer.
      txb.transferObjects([sub], txb.pure.address(keypair.toSuiAddress()));
      const result = await suiClient.signAndExecuteTransaction({
        signer: keypair,
        transaction: txb,
        options: { showEffects: true, showObjectChanges: true },
      });
      return {
        rail: 'sui_usdc',
        tx_or_receipt: result.digest,
        amount_usdc: offer.amount_usdc,
        ts: Date.now(),
      };
    } catch {
      return mockReceipt('sui_usdc', offer);
    }
  },
};

// ---------------------------------------------------------------------------
// Router — composition root.
// ---------------------------------------------------------------------------

export class PayRouter {
  private adapters: Partial<Record<Rail, RailAdapter>>;
  constructor(adapters?: Partial<Record<Rail, RailAdapter>>) {
    this.adapters = {
      x402: adapters?.x402 ?? x402Adapter,
      mpp: adapters?.mpp ?? mppAdapter,
      sui_usdc: adapters?.sui_usdc ?? suiUsdcAdapter,
      // fherc20 is browser-only — caller must register it via {@link PayRouter} ctor.
      ...(adapters?.fherc20 ? { fherc20: adapters.fherc20 } : {}),
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
    if (!adapter) throw new Error(`payRouter:adapter-not-registered:${rail}`);
    return adapter.pay(offer, { challenge, opts });
  }

  private walletCanUse(rail: Rail, prefs: WalletPrefs): boolean {
    if (rail === 'x402') return prefs.hasEvmWallet ?? true;
    if (rail === 'mpp') return prefs.hasMppFunds ?? prefs.hasEvmWallet ?? true;
    if (rail === 'sui_usdc') return prefs.hasSuiWallet ?? false;
    // fherc20 needs both an EVM wallet AND a CoFHE permit; caller checks the latter.
    if (rail === 'fherc20') return prefs.hasEvmWallet ?? false;
    return false;
  }
}
