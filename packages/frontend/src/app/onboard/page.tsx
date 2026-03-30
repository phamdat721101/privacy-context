'use client';
import { useEffect } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useRouter } from 'next/navigation';
import { OnboardForm } from '@/components/OnboardForm';

export default function OnboardPage() {
  const { authenticated, ready } = usePrivy();
  const router = useRouter();

  useEffect(() => {
    if (ready && !authenticated) router.push('/');
  }, [ready, authenticated, router]);

  if (!ready || !authenticated) return null;

  return (
    <main className="page-container flex items-center justify-center min-h-screen px-4 pb-28" style={{ background: 'var(--pixel-black)' }}>
      <OnboardForm onDone={() => router.push('/chat')} />
    </main>
  );
}
