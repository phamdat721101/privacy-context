'use client';
import { useState, useEffect } from 'react';
import { useWallets } from '@privy-io/react-auth';
import { BrowserProvider, Contract } from 'ethers';
import { BRAIN_KEY_VAULT_ADDRESS, AGENT_BACKEND_URL } from '@/lib/contracts';
import type { PermitState } from '@/types/context';

const VAULT_ABI = [
  'function authorize(address platform)',
  'function revoke(address platform)',
  'function isAuthorized(address user, address platform) view returns (bool)',
];

export function usePermit(userAddress: `0x${string}` | undefined) {
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
    if (stored) {
      try { setPermitState(JSON.parse(stored)); } catch {}
    }
  }, [userAddress]);

  async function authorize(platformWallet: `0x${string}`) {
    if (!userAddress || !wallets.length) {
      setError('Wallet not connected'); return;
    }
    setLoading(true);
    setError(null);
    try {
      const pw = wallets[0];
      await pw.switchChain(421614);
      const provider = await pw.getEthereumProvider();
      const ethersProvider = new BrowserProvider(provider);
      const signer = await ethersProvider.getSigner();
      const contract = new Contract(BRAIN_KEY_VAULT_ADDRESS, VAULT_ABI, signer);

      const tx = await contract.authorize(platformWallet);
      await tx.wait();

      const newState = { serializedPermit: tx.hash, permitId: tx.hash, expiresAt: null };
      setPermitState(newState);
      localStorage.setItem(`fhe_permit_${userAddress}`, JSON.stringify(newState));

      // Notify backend (it can also read on-chain directly)
      await fetch(`${AGENT_BACKEND_URL}/permit/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userAddress, serializedPermit: tx.hash }),
      }).catch(() => {});
    } catch (e: any) {
      setError(e?.shortMessage || e?.message || 'Authorization failed');
    } finally {
      setLoading(false);
    }
  }

  async function revoke() {
    if (!userAddress || !wallets.length) return;
    setLoading(true);
    try {
      const pw = wallets[0];
      const provider = await pw.getEthereumProvider();
      const signer = await new BrowserProvider(provider).getSigner();
      const contract = new Contract(BRAIN_KEY_VAULT_ADDRESS, VAULT_ABI, signer);
      // Revoke against the cached platform address (best effort)
      const platform = (await fetch(`${AGENT_BACKEND_URL}/platform`).then(r => r.json())).platformWallet;
      const tx = await contract.revoke(platform);
      await tx.wait();
      await fetch(`${AGENT_BACKEND_URL}/permit/revoke`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userAddress }),
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
