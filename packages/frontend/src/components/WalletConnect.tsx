'use client';
import Link from 'next/link';
import { usePrivy } from '@privy-io/react-auth';

/**
 * Account control for the global header.
 *
 * Neutral surface: signed-out shows "Sign in"; signed-in shows the user's
 * email (fallback "Account") with a status dot — never a raw address. Auth is
 * still Privy under the hood; only the surfaced label is neutral.
 *
 * `creditsLabel` (optional) renders the buyer's credit balance inline in the
 * same pill, e.g. "user@example.com · $12.50" (Q1). When present, the whole
 * pill links to the Studio Wallet tab. When absent (credit system disabled
 * or balance unavailable), the pill falls back to account-name-only with no
 * link — never a placeholder/broken state (Q6). Sign-out stays a separate
 * button next to the pill either way (Q7).
 *
 * SRP: this component owns the sign-in/out affordance + optional inline
 * balance display; it does not fetch or own the balance itself.
 */
export function WalletConnect({ creditsLabel }: { creditsLabel?: string } = {}) {
  const { ready, authenticated, login, logout, user } = usePrivy();

  if (!ready) {
    return (
      <button
        disabled
        className="rounded-full bg-surface-container-high px-4 py-2 text-sm text-on-surface-variant"
      >
        Loading…
      </button>
    );
  }

  if (authenticated) {
    const label = user?.email?.address ?? 'Account';
    const pillContent = (
      <>
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-secondary" />
        <span className="truncate">{label}</span>
        {creditsLabel && (
          <>
            <span className="shrink-0 text-on-surface-variant">·</span>
            <span className="shrink-0 font-mono">{creditsLabel}</span>
          </>
        )}
      </>
    );
    const pillClassName =
      'flex max-w-[16rem] items-center gap-1.5 truncate rounded-full border border-outline-variant/40 bg-surface-container-high px-2.5 py-1.5 text-xs text-primary transition-colors sm:px-3';
    return (
      <div className="flex items-center gap-2">
        {creditsLabel ? (
          <Link
            href="/studio?tab=wallet"
            aria-label={`${label} — balance ${creditsLabel} — go to Studio Wallet`}
            title={`${label} — ${creditsLabel}`}
            className={`${pillClassName} hover:border-primary/60`}
          >
            {pillContent}
          </Link>
        ) : (
          <span title={label} className={pillClassName}>
            {pillContent}
          </span>
        )}
        <button
          onClick={logout}
          className="hidden rounded-full border border-outline-variant/30 px-3 py-1.5 text-xs text-on-surface-variant transition-colors hover:border-error/40 hover:text-error sm:inline"
        >
          Sign out
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={login}
      className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-on-primary transition-colors hover:bg-primary/90"
    >
      Sign in
    </button>
  );
}
