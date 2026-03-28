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
    <main className="flex items-center justify-center min-h-screen px-4">
      <OnboardForm onDone={() => router.push('/chat')} />
    </main>
  );
}
