'use client';
import { useState, useEffect } from 'react';
import { useWalletClient } from 'wagmi';
import { useWallets } from '@privy-io/react-auth';
import { createWalletClient, custom } from 'viem';
import { arbitrumSepolia as viemArbitrumSepolia } from 'viem/chains';
import { createPermit, revokePermit, arbitrumSepolia } from '@fhe-ai-context/sdk';
import { CONTEXT_MANAGER_ADDRESS, AGENT_BACKEND_URL } from '@/lib/contracts';
import type { PermitState } from '@/types/context';

export function usePermit(userAddress: `0x${string}` | undefined) {
  const { data: wagmiWalletClient } = useWalletClient();
  const { wallets } = useWallets();
  const [permitState, setPermitState] = useState<PermitState>({
    serializedPermit: null,
    permitId: null,
    expiresAt: null,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userAddress) return;
    const stored = localStorage.getItem(`fhe_permit_${userAddress}`);
    if (!stored) return;
    try { setPermitState(JSON.parse(stored)); } catch { /* ignore corrupted */ }
  }, [userAddress]);

  async function authorize(agentAddress: `0x${string}`) {
    if (!userAddress) { setError('No wallet address found'); return; }
    setLoading(true);
    setError(null);
    try {
      let signer: any = wagmiWalletClient;
      if (!signer && wallets.length > 0) {
        const pw = wallets[0];
        await pw.switchChain(421614);
        const provider = await pw.getEthereumProvider();
        signer = createWalletClient({ chain: viemArbitrumSepolia, transport: custom(provider) });
      }
      if (!signer) throw new Error('No wallet client — please reconnect your wallet');

      const permit = await createPermit(
        { contractAddress: CONTEXT_MANAGER_ADDRESS, agentAddress },
        arbitrumSepolia,
        signer,
      );
      const serialized = JSON.stringify(permit);
      const res = await fetch(`${AGENT_BACKEND_URL}/permit/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userAddress, serializedPermit: serialized }),
      });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error ?? 'Failed to import permit');
      }
      const newState = {
        serializedPermit: serialized,
        permitId: (permit as any).id ?? null,
        expiresAt: (permit as any).expiration ?? null,
      };
      setPermitState(newState);
      localStorage.setItem(`fhe_permit_${userAddress}`, JSON.stringify(newState));
    } catch (e: any) {
      setError(e?.message ?? 'Authorization failed');
    } finally {
      setLoading(false);
    }
  }

  async function revoke() {
    if (!userAddress || !permitState.permitId) return;
    setLoading(true);
    setError(null);
    try {
      await revokePermit(permitState.permitId, arbitrumSepolia, userAddress);
      await fetch(`${AGENT_BACKEND_URL}/permit/revoke`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userAddress, permitId: permitState.permitId }),
      });
      setPermitState({ serializedPermit: null, permitId: null, expiresAt: null });
      localStorage.removeItem(`fhe_permit_${userAddress}`);
    } catch (e: any) {
      setError(e?.message ?? 'Revoke failed');
    } finally {
      setLoading(false);
    }
  }

  return { permitState, authorize, revoke, loading, error };
}
