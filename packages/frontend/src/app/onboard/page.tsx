'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { usePrivy } from '@privy-io/react-auth';
import { WalletConnect } from '@/components/WalletConnect';
import { PermitManager } from '@/components/PermitManager';
import { usePermit } from '@/hooks/usePermit';

/**
 * 3-step onboarding wizard. Each step gates the next.
 *   1. Connect wallet (Privy)
 *   2. Authorize FHE permit (BrainKeyVault.authorize)
 *   3. Subscribe (x402 paywall) — link out to /payments which auto-returns here
 *
 * Once all three are complete, redirect to /chat.
 */
export default function OnboardPage() {
  const router = useRouter();
  const { authenticated, ready, user } = usePrivy();
  const addr = user?.wallet?.address as `0x${string}` | undefined;
  const { permitState, authorize, revoke, loading, error } = usePermit(addr);

  const step = !authenticated ? 1 : !permitState.serializedPermit ? 2 : 3;

  // Step 3 is "go subscribe" — once we trust both wallet + permit, send the
  // user to /payments. Subscription state is checked server-side at /chat.
  useEffect(() => {
    if (step === 3) router.replace('/payments');
  }, [step, router]);

  if (!ready) return null;

  return (
    <main className="bg-background text-on-surface min-h-screen flex flex-col items-center px-4 py-12">
      <div className="w-full max-w-md space-y-8">
        <header className="text-center space-y-2">
          <h1 className="font-headline text-3xl font-bold">Set up your Second Brain</h1>
          <p className="text-on-surface-variant text-sm">
            Three steps. Each is cryptographically gated.
          </p>
        </header>

        <ol className="space-y-4">
          <Step n={1} active={step === 1} done={step > 1} title="Connect wallet">
            <WalletConnect />
          </Step>

          <Step n={2} active={step === 2} done={step > 2} title="Authorize FHE permit">
            {step >= 2 && addr ? (
              <PermitManager
                permitState={permitState}
                authorize={authorize}
                revoke={revoke}
                loading={loading}
                error={error}
              />
            ) : (
              <p className="text-text-muted text-sm">Complete step 1 first.</p>
            )}
          </Step>

          <Step n={3} active={step === 3} done={false} title="Subscribe">
            {step >= 3 ? (
              <Link href="/payments" className="pixel-btn pixel-btn-primary inline-block">
                Continue to subscription →
              </Link>
            ) : (
              <p className="text-text-muted text-sm">Complete step 2 first.</p>
            )}
          </Step>
        </ol>
      </div>
    </main>
  );
}

function Step({
  n, active, done, title, children,
}: { n: number; active: boolean; done: boolean; title: string; children: React.ReactNode }) {
  return (
    <li
      className={`rounded-lg border p-5 transition-colors ${
        done
          ? 'border-secondary/40 bg-secondary/5'
          : active
            ? 'border-primary/40 bg-primary/5'
            : 'border-outline-variant/30 bg-surface-container/40'
      }`}
    >
      <div className="flex items-center gap-3 mb-3">
        <span
          className={`w-7 h-7 rounded-full flex items-center justify-center font-mono text-sm ${
            done
              ? 'bg-secondary text-on-secondary'
              : active
                ? 'bg-primary text-on-primary'
                : 'bg-surface-container-highest text-text-muted'
          }`}
        >
          {done ? '✓' : n}
        </span>
        <h2 className="font-semibold">{title}</h2>
      </div>
      {children}
    </li>
  );
}
