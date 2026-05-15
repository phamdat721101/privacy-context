'use client';
import { useState, useEffect } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { BottomNav } from '@/components/BottomNav';
import { AGENT_BACKEND_URL } from '@/lib/contracts';

const TIERS = [
  { id: 'week', label: 'Weekly', price: '$5', duration: '7 days', icon: 'bolt' },
  { id: 'month', label: 'Monthly', price: '$15', duration: '30 days', icon: 'star', best: true },
  { id: 'quarter', label: 'Quarterly', price: '$35', duration: '90 days', icon: 'diamond' },
];

export default function SubscribePage() {
  const { authenticated, user, ready } = usePrivy();
  const router = useRouter();
  const userAddress = user?.wallet?.address;
  const [subscribing, setSubscribing] = useState<string | null>(null);
  const [result, setResult] = useState<{ tier: string; expiresAt: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (ready && !authenticated) router.push('/'); }, [ready, authenticated, router]);

  async function handleSubscribe(tier: string) {
    if (!userAddress) return;
    setSubscribing(tier); setError(null);
    try {
      const res = await fetch(`${AGENT_BACKEND_URL}/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-wallet-address': userAddress },
        body: JSON.stringify({ tier }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setResult(await res.json());
    } catch (e: any) { setError(e.message); }
    finally { setSubscribing(null); }
  }

  if (!ready || !authenticated) return null;

  return (
    <main className="bg-background text-text-primary min-h-screen pb-[120px]">
      <header className="bg-surface-container/80 backdrop-blur-lg border-b border-outline-variant/20 flex items-center px-4 md:px-8 h-[72px] sticky top-0 z-50">
        <Link href="/" className="text-on-surface-variant hover:text-primary p-2 rounded-full"><span className="material-symbols-outlined">arrow_back</span></Link>
        <span className="font-headline text-2xl font-bold text-on-surface ml-4">Subscribe</span>
      </header>

      <div className="max-w-4xl mx-auto px-4 md:px-8 pt-12">
        <div className="text-center mb-10">
          <h1 className="font-headline text-3xl font-bold mb-2">One subscription. All brains.</h1>
          <p className="text-on-surface-variant">Unlock access to every published brain in the catalog</p>
        </div>

        {result && (
          <div className="mb-8 bg-secondary/10 border border-secondary/30 rounded-xl p-4 text-center">
            <span className="material-symbols-outlined text-secondary mr-2" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
            <span className="text-secondary font-medium">Subscribed ({result.tier}) — Expires {new Date(result.expiresAt).toLocaleDateString()}</span>
          </div>
        )}
        {error && <div className="mb-8 text-error text-center text-sm">{error}</div>}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {TIERS.map(tier => (
            <div key={tier.id} className={`relative rounded-xl p-[1px] ${tier.best ? 'bg-gradient-to-b from-primary to-secondary' : 'bg-outline-variant/30'}`}>
              <div className="bg-card rounded-[11px] p-6 text-center h-full flex flex-col">
                {tier.best && <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-on-primary text-[11px] font-mono px-3 py-1 rounded-full">BEST VALUE</span>}
                <span className="material-symbols-outlined text-primary text-3xl mb-4">{tier.icon}</span>
                <h3 className="font-headline text-lg font-semibold mb-1">{tier.label}</h3>
                <div className="font-headline text-4xl font-bold text-text-primary my-3">{tier.price}</div>
                <p className="text-text-muted text-sm mb-6">{tier.duration} • USDC</p>
                <button
                  onClick={() => handleSubscribe(tier.id)}
                  disabled={subscribing !== null}
                  className="mt-auto w-full py-3 rounded-full bg-primary text-on-primary font-semibold hover:bg-primary/80 transition-colors disabled:opacity-50"
                >
                  {subscribing === tier.id ? 'Processing...' : 'Subscribe'}
                </button>
              </div>
            </div>
          ))}
        </div>

        <p className="text-center text-text-muted text-xs mt-8">Powered by x402 protocol • FHE-encrypted on Arbitrum Sepolia</p>
      </div>
      <BottomNav />
    </main>
  );
}
