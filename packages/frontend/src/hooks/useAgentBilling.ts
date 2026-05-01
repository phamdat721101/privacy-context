'use client';
import { useState } from 'react';
import { useWriteContract, useReadContract, usePublicClient } from 'wagmi';
import { useWallets } from '@privy-io/react-auth';
import { createWalletClient, custom } from 'viem';
import { arbitrumSepolia as viemArbitrumSepolia } from 'viem/chains';
import { encryptTopUp, encryptPayment, arbitrumSepolia } from '@fhe-ai-context/sdk';
import {
  PAYMENT_TOKEN_ADDRESS, AGENT_BILLING_ADDRESS, AGENT_BACKEND_URL,
  PaymentTokenAbi, AgentBillingAbi,
} from '@/lib/contracts';

export function useBillingBalance(userAddress?: `0x${string}`, agentAddress?: `0x${string}`) {
  return useReadContract({
    address: AGENT_BILLING_ADDRESS,
    abi: AgentBillingAbi,
    functionName: 'getBalanceHandle',
    args: userAddress && agentAddress ? [userAddress, agentAddress] : undefined,
    query: { enabled: Boolean(userAddress && agentAddress) },
  });
}

export function useTopUpBilling() {
  const { writeContractAsync, isPending } = useWriteContract();
  const publicClient = usePublicClient();
  const { wallets } = useWallets();
  const [error, setError] = useState<string | null>(null);

  async function topUp(userAddress: `0x${string}`, agentAddress: `0x${string}`, amount: bigint) {
    setError(null);
    try {
      const pw = wallets[0]; await pw.switchChain(421614);
      const provider = await pw.getEthereumProvider();
      const wc = createWalletClient({ chain: viemArbitrumSepolia, transport: custom(provider), account: userAddress });

      // 1. Approve billing contract to spend tokens
      const encApprove = await encryptPayment({ amount }, arbitrumSepolia, wc);
      let hash = await writeContractAsync({
        address: PAYMENT_TOKEN_ADDRESS, abi: PaymentTokenAbi,
        functionName: 'encryptedApprove', args: [AGENT_BILLING_ADDRESS, encApprove.inAmount],
      });
      await publicClient!.waitForTransactionReceipt({ hash });

      // 2. Top up billing balance
      const enc = await encryptTopUp(amount, arbitrumSepolia, wc);
      hash = await writeContractAsync({
        address: AGENT_BILLING_ADDRESS, abi: AgentBillingAbi,
        functionName: 'topUp', args: [agentAddress, enc.inAmount],
      });
      await publicClient!.waitForTransactionReceipt({ hash });
    } catch (e: any) { setError(e?.message ?? 'Top up failed'); }
  }
  return { topUp, isPending, error };
}

export function useBillingInfo() {
  const [info, setInfo] = useState<{ agentAddress: string; billingAddress: string } | null>(null);
  const [loading, setLoading] = useState(false);

  async function fetchInfo() {
    setLoading(true);
    try {
      const res = await fetch(`${AGENT_BACKEND_URL}/billing/info`);
      if (res.ok) setInfo(await res.json());
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }
  return { info, fetchInfo, loading };
}
