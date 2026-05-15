'use client';
import { usePrivy } from '@privy-io/react-auth';
import Link from 'next/link';
import { WalletConnect } from '@/components/WalletConnect';
import { BottomNav } from '@/components/BottomNav';

const CARDS = [
  { href: '/chat', icon: 'psychology', title: 'CHAT', desc: 'Store & Learn' },
  { href: '/marketplace', icon: 'language', title: 'BRAINS', desc: 'Browse catalog' },
  { href: '/memory', icon: 'inventory_2', title: 'MY BRAIN', desc: 'Upload' },
  { href: '/payments', icon: 'credit_card', title: 'SUBSCRIBE', desc: 'Unlock' },
];

export default function HomePage() {
  const { authenticated, ready, user } = usePrivy();
  const addr = user?.wallet?.address;

  if (!ready) return (
    <main className="flex items-center justify-center min-h-screen bg-background">
      <span className="text-text-muted font-mono text-sm">Loading...</span>
    </main>
  );

  return (
    <main className="bg-background text-text-primary min-h-screen flex flex-col pb-[120px]">
      {/* Header */}
      <header className="bg-surface-container/80 backdrop-blur-lg border-b border-outline-variant/20 flex justify-between items-center px-4 md:px-8 h-[72px] sticky top-0 z-50">
        <span className="font-headline text-2xl font-bold text-on-surface tracking-tight">FHE Second Brain</span>
        <div className="flex items-center gap-3">
          {authenticated && addr && (
            <div className="px-3 py-1.5 bg-surface-container-highest border border-outline-variant/30 rounded-full font-mono text-[13px] text-primary flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-secondary" />
              {addr.slice(0, 6)}...{addr.slice(-4)}
            </div>
          )}
          <WalletConnect />
        </div>
      </header>

      {/* Content */}
      <div className="w-full max-w-7xl mx-auto px-4 md:px-8 pt-12 pb-24 flex-grow">
        {!authenticated ? (
          <div className="flex flex-col items-center justify-center gap-6 pt-20">
            <h1 className="font-headline text-4xl font-bold tracking-tight text-center">Your knowledge.<br/>Encrypted. On-chain.</h1>
            <p className="text-on-surface-variant text-lg text-center max-w-md">Private AI Second Brain powered by Fhenix FHE. Store, learn, and share knowledge with cryptographic privacy.</p>
            <WalletConnect />
          </div>
        ) : (
          <>
            <h1 className="font-headline text-4xl font-bold mb-6">Overview</h1>
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 mb-12">
              <div className="inline-flex items-center gap-2 bg-secondary/10 border border-secondary/20 rounded-full px-4 py-2">
                <span className="material-symbols-outlined text-secondary text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>shield</span>
                <span className="text-sm text-secondary font-medium">Subscription Active</span>
              </div>
              <div className="inline-flex items-center gap-2 bg-primary/10 border border-primary/20 rounded-full px-4 py-2">
                <span className="material-symbols-outlined text-primary text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>key</span>
                <span className="text-sm text-primary font-medium">FHE Authorized</span>
              </div>
              <div className="inline-flex items-center gap-2 bg-surface-container-high border border-outline-variant/30 rounded-full px-4 py-2">
                <span className="material-symbols-outlined text-text-muted text-sm">lock</span>
                <span className="text-sm text-text-muted">Brain: FHE-encrypted</span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {CARDS.map(card => (
                <Link key={card.href} href={card.href} className="gradient-card group">
                  <div className="gradient-card-inner">
                    <div className="absolute inset-0 bg-primary/5 opacity-0 group-hover:opacity-100 transition-opacity" />
                    <div className="relative z-10">
                      <div className="w-12 h-12 rounded-lg bg-surface-container-highest border border-outline-variant/30 flex items-center justify-center mb-6">
                        <span className="material-symbols-outlined text-primary text-2xl">{card.icon}</span>
                      </div>
                      <h2 className="text-lg text-text-primary font-semibold mb-1">{card.title}</h2>
                      <p className="text-sm text-text-muted">{card.desc}</p>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </>
        )}
      </div>

      <BottomNav />
    </main>
  );
}
