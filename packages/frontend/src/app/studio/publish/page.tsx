'use client';

/**
 * /studio/publish — wizard host page.
 *
 * Thin shell: fetches the user's brains and the connected wallet's address,
 * then hands off to {@link PublishWizard}. All step state lives in URL
 * search params via the wizard.
 */

import { useEffect, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { listMyAgents, type Agent } from '@/lib/agents';
import { AGENT_BACKEND_URL } from '@/lib/contracts';
import { PublishWizard } from '@/components/PublishWizard';
import { useActiveWallet } from '@/hooks/useActiveWallet';

interface BrainRow {
  id: number;
  title: string;
  description?: string;
  tags?: string[];
}

interface PublishConfig {
  brainId: number;
  slug: string;
  priceUsdc: string;
  network: 'arbitrum-sepolia' | 'sui-testnet' | 'sui-mainnet';
  method: 'exact' | 'fherc20';
  acceptPrivate: boolean;
  payTo: `0x${string}`;
  agentPrompt: string;
}

export default function PublishPage() {
  const { ready, authenticated, login } = usePrivy();
  // Active wallet — Sui address on Sui networks, EVM address otherwise.
  // Uses the same hook as /studio so the brain list here matches the
  // ownership shown in the Studio detail page (no cross-chain leakage).
  const { address } = useActiveWallet();
  const userAddress = address as `0x${string}` | undefined;
  const [brains, setBrains] = useState<BrainRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userAddress) return;
    setLoading(true);
    listMyAgents(userAddress)
      .then((list: Agent[]) => setBrains(list.map((a) => ({ id: Number(a.id), title: a.title, description: a.description, tags: a.tags }))))
      .finally(() => setLoading(false));
  }, [userAddress]);

  async function handlePublish(cfg: PublishConfig): Promise<{ agentId: string; slug: string } | { error: string }> {
    if (!userAddress) return { error: 'Not signed in' };
    const pricing: Record<string, string | null> = { x402: cfg.priceUsdc };
    if (cfg.acceptPrivate) pricing.fherc20 = cfg.priceUsdc;

    // 1. Create the agent record (DB, draft state).
    const persona: { description: string; system_prompt?: string } = {
      description: 'OpenX paid API for brain ' + cfg.brainId,
    };
    const trimmedPrompt = cfg.agentPrompt?.trim();
    if (trimmedPrompt) persona.system_prompt = trimmedPrompt;
    const create = await fetch(`${AGENT_BACKEND_URL}/v3/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-wallet-address': userAddress },
      body: JSON.stringify({
        brain_id: cfg.brainId,
        chain: cfg.network,
        slug: cfg.slug,
        persona,
        pricing,
        kya_required: false,
        min_reputation: 0,
      }),
    });
    if (!create.ok) {
      const body = await create.json().catch(() => ({}));
      return { error: body.error ?? `create failed (${create.status})` };
    }
    const agent = await create.json();

    // 2. Publish.
    const pub = await fetch(`${AGENT_BACKEND_URL}/v3/agents/${agent.id}/publish`, {
      method: 'POST',
      headers: { 'x-wallet-address': userAddress },
    });
    if (!pub.ok) {
      const body = await pub.json().catch(() => ({}));
      return { error: body.error ?? `publish failed (${pub.status})` };
    }
    return { agentId: agent.id, slug: cfg.slug };
  }

  if (!ready) return null;
  if (!authenticated || !userAddress) {
    return (
      <div className="space-y-3 py-20 text-center">
        <h1 className="font-headline text-2xl font-bold">Sign in to publish</h1>
        <button onClick={login} className="rounded-full bg-primary px-5 py-3 text-on-primary">
          Connect wallet
        </button>
      </div>
    );
  }
  if (loading) return <div className="py-20 text-center text-on-surface-variant">Loading brains…</div>;

  return <PublishWizard brains={brains} defaultPayTo={userAddress} onPublish={handlePublish} />;
}
