'use client';
import { useState } from 'react';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { createWalletClient, custom } from 'viem';
import { arbitrumSepolia as viemArbitrumSepolia } from 'viem/chains';
import { encryptContext, createPermit, arbitrumSepolia, encodeSentiment } from '@fhe-ai-context/sdk';
import { useWriteContext } from '@/hooks/useWriteContext';
import { CONTEXT_MANAGER_ADDRESS, AGENT_BACKEND_URL, AGENT_ADDRESS } from '@/lib/contracts';

export function OnboardForm({ onDone }: { onDone: () => void }) {
  const { user } = usePrivy();
  const { wallets } = useWallets();
  const { writeContext, isPending } = useWriteContext();
  const [activating, setActivating] = useState(false);
  const [activateError, setActivateError] = useState<string | null>(null);

  async function handleActivate() {
    const userAddress = user?.wallet?.address as `0x${string}` | undefined;
    if (!userAddress || activating || isPending) return;
    setActivating(true);
    setActivateError(null);
    try {
      if (!wallets.length) throw new Error('No wallet found');
      const pw = wallets[0];
      await pw.switchChain(421614);
      const provider = await pw.getEthereumProvider();
      const walletClient = createWalletClient({
        chain: viemArbitrumSepolia,
        transport: custom(provider),
        account: userAddress,
      });

      // Step 1: encrypt + write context on-chain (awaits tx confirmation)
      const inputs = await encryptContext(
        {
          userId:          BigInt('0x' + userAddress.slice(2).padStart(16, '0').slice(0, 16)),
          sessionKey:      BigInt(Date.now()),
          sentimentScore:  encodeSentiment('neutral'),
          trustLevel:      1,
          isVerified:      false,
          authorizedAgent: AGENT_ADDRESS,
        },
        arbitrumSepolia,
        CONTEXT_MANAGER_ADDRESS,
        walletClient,
      );
      await writeContext(inputs);

      // Step 2: create permit so agent can decrypt context
      const permit = await createPermit(
        { contractAddress: CONTEXT_MANAGER_ADDRESS, agentAddress: AGENT_ADDRESS },
        arbitrumSepolia,
        walletClient,
      );
      const serialized = permit;

      // Step 3: import permit to agent backend
      await fetch(`${AGENT_BACKEND_URL}/permit/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userAddress, serializedPermit: serialized }),
      });

      // Step 4: persist permit so chat page loads it immediately
      localStorage.setItem(`fhe_permit_${userAddress}`, JSON.stringify({
        serializedPermit: serialized,
        permitId: (permit as any).id ?? null,
        expiresAt: (permit as any).expiration ?? null,
      }));

      onDone();
    } catch (e: any) {
      setActivateError(e?.message ?? 'Activation failed');
    } finally {
      setActivating(false);
    }
  }

  return (
    <div className="pixel-card-gold space-y-6 w-full max-w-md mx-auto text-center" style={{ background: 'var(--pixel-dark)' }}>
      <div style={{ fontFamily: "'Press Start 2P'", fontSize: '9px', color: 'var(--pixel-red)', textShadow: '2px 2px 0 var(--pixel-gold)' }}>
        PRIVATE AI SETUP
      </div>
      <p style={{ fontFamily: "'VT323'", fontSize: '16px', color: 'var(--pixel-teal)' }}>
        YOUR CONTEXT WILL BE ENCRYPTED<br />
        AND STORED ON ARBITRUM.<br />
        ONLY YOUR PERMITTED AGENT CAN READ IT.
      </p>
      {activateError && (
        <div style={{ fontFamily: "'VT323'", fontSize: '14px', color: 'var(--pixel-danger)' }}>
          ⚠ {activateError}
        </div>
      )}
      <button
        onClick={handleActivate}
        disabled={isPending || activating}
        className="pixel-btn pixel-btn-primary w-full"
        style={{ textAlign: 'center' }}
      >
        {isPending || activating ? 'ACTIVATING...' : 'ACTIVATE PRIVATE AI'}
      </button>
    </div>
  );
}
