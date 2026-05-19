'use client';
import { usePrivy } from '@privy-io/react-auth';
import { useFheClient } from '@/hooks/useFheClient';
import { useState } from 'react';

export default function SettingsPage() {
  const { authenticated, user, logout, login } = usePrivy();
  const { ready, ensurePermit } = useFheClient();
  const [permitActive, setPermitActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const addr = user?.wallet?.address;

  const togglePermit = async () => {
    setLoading(true);
    try {
      if (!permitActive) { await ensurePermit(); setPermitActive(true); }
      else { setPermitActive(false); }
    } catch { /* noop */ }
    setLoading(false);
  };

  const content = !authenticated ? (
    <div className="flex flex-col items-center justify-center flex-1 gap-4 p-4">
      <p className="text-on-surface-variant">Connect wallet to access settings.</p>
      <button onClick={login} className="px-4 py-2 bg-primary-container text-on-primary-container rounded-lg text-sm font-medium">Connect</button>
    </div>
  ) : (
    <div className="p-4 max-w-2xl mx-auto w-full space-y-6 pb-24">
      <section className="rounded-lg border border-border bg-card p-4 space-y-2">
        <h2 className="font-semibold text-sm">Wallet</h2>
        <p className="font-mono text-xs text-on-surface-variant">{addr}</p>
        <p className="text-xs text-text-muted">Network: Arbitrum Sepolia</p>
        <button onClick={logout} className="text-xs text-error hover:underline mt-2">Disconnect</button>
      </section>
      <section className="rounded-lg border border-border bg-card p-4 space-y-2">
        <h2 className="font-semibold text-sm">FHE Permit</h2>
        <p className="text-xs text-on-surface-variant">
          {permitActive ? 'Authorized - your brain is unlocked' : 'Not authorized - chat will not work'}
        </p>
        <button onClick={togglePermit} disabled={loading || !ready}
          className={`px-3 py-1.5 rounded text-xs font-medium ${permitActive ? 'bg-error-container/20 text-error' : 'bg-primary-container text-on-primary-container'} disabled:opacity-50`}>
          {loading ? '...' : permitActive ? 'Revoke Permit' : 'Authorize'}
        </button>
      </section>
      <section className="rounded-lg border border-border bg-card p-4 space-y-2">
        <h2 className="font-semibold text-sm">Subscription</h2>
        <p className="text-xs text-on-surface-variant">Status: check on-chain via decryptForView (gasless)</p>
      </section>
    </div>
  );

  return (
    <main className="flex flex-col min-h-screen bg-background text-on-surface">
      <header className="sticky top-0 z-40 flex items-center border-b border-border bg-surface/80 backdrop-blur px-4 py-3">
        <h1 className="font-bold text-lg">Settings</h1>
      </header>
      {content}
      <nav className="fixed bottom-0 inset-x-0 flex border-t border-border bg-surface/90 backdrop-blur z-40">
        <a href="/brain" className="flex-1 py-3 text-center text-xs text-text-muted">Brain</a>
        <a href="/catalog" className="flex-1 py-3 text-center text-xs text-text-muted">Catalog</a>
        <a href="/settings-v2" className="flex-1 py-3 text-center text-xs text-primary font-medium">Settings</a>
      </nav>
    </main>
  );
}
