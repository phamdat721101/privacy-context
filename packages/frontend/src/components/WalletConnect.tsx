'use client';
import { usePrivy } from '@privy-io/react-auth';

/**
 * Account control for the global header.
 *
 * Neutral surface: signed-out shows "Sign in"; signed-in shows the user's
 * email (fallback "Account") with a status dot — never a raw address. Auth is
 * still Privy under the hood; only the surfaced label is neutral.
 *
 * SRP: this component owns nothing but the sign-in/out affordance.
 */
export function WalletConnect() {
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
    return (
      <div className="flex items-center gap-2">
        <span
          title={label}
          className="flex max-w-[12rem] items-center gap-1.5 truncate rounded-full border border-outline-variant/40 bg-surface-container-high px-2.5 py-1.5 text-xs text-primary sm:px-3"
        >
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-secondary" />
          <span className="truncate">{label}</span>
        </span>
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
