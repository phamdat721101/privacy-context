'use client';

/**
 * TopUpModal (PRD-G) — buy credits via on-chain USDC transfer.
 *
 * Flow:
 *   1. Read GET /v3/credits/config — gets PLATFORM_PAYOUT_ADDRESS + packs.
 *   2. User picks a pack → wallet signs `USDC.transfer(payout, packUSDC)`.
 *   3. Wait for tx confirmation.
 *   4. POST /v3/credits/topup { tx_hash, pack_usdc } — server verifies the
 *      on-chain Transfer log + grants credits (idempotent).
 *
 * Why no n-payment here:
 *   n-payment is a Node-only SDK (uses Node crypto + x402-spec key handling).
 *   The browser equivalent is a direct USDC transfer + server-side verify —
 *   simpler, no extra browser dep, same end state (credits granted, tx_hash
 *   recorded). The x402-paywalled /api/v1/credits/buy-pack-N endpoint stays
 *   for AI-agent buyers.
 *
 * SRP: this component renders + drives the on-chain step. Balance reads
 * + ledger writes live in their respective owners (useCredits, creditService).
 */

import { useEffect, useState } from 'react';
import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  parseAbi,
  parseUnits,
} from 'viem';
import { arbitrumSepolia } from 'viem/chains';
import { usePrivyEvmWallet } from '@/hooks/useActiveWallet';
import { AGENT_BACKEND_URL } from '@/lib/contracts';

const ERC20_ABI = parseAbi([
  'function transfer(address to, uint256 amount) returns (bool)',
]);

interface Config {
  enabled: boolean;
  payout_address: string | null;
  usdc_address: string;
  chain_id: number;
  packs: number[];
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function TopUpModal({ open, onClose, onSuccess }: Props) {
  const wallet = usePrivyEvmWallet();
  const [cfg, setCfg] = useState<Config | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [status, setStatus] = useState<string>('');
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open || cfg) return;
    fetch(`${AGENT_BACKEND_URL}/v3/credits/config`)
      .then((r) => (r.ok ? r.json() : null))
      .then((c: Config | null) => setCfg(c))
      .catch(() => setCfg(null));
  }, [open, cfg]);

  if (!open) return null;

  async function buy(pack: number) {
    setErr(null);
    setBusy(pack);
    try {
      if (!wallet?.address) throw new Error('Sign in first.');
      if (!cfg?.enabled) throw new Error('Credit system not enabled on the API.');
      if (!cfg.payout_address) throw new Error('Platform payout wallet not configured.');

      setStatus('Switching to Arbitrum Sepolia…');
      await wallet.switchChain(cfg.chain_id);
      const provider = await wallet.getEthereumProvider();
      const walletClient = createWalletClient({
        chain: arbitrumSepolia,
        transport: custom(provider),
        account: wallet.address as `0x${string}`,
      });
      const publicClient = createPublicClient({ chain: arbitrumSepolia, transport: http() });
      const value = parseUnits(String(pack), 6); // USDC = 6 decimals

      setStatus('Sign the USDC transfer in your wallet…');
      const hash = await walletClient.writeContract({
        address: cfg.usdc_address as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'transfer',
        args: [cfg.payout_address as `0x${string}`, value],
      });

      setStatus('Waiting for confirmation…');
      await publicClient.waitForTransactionReceipt({ hash });

      setStatus('Crediting your balance…');
      const r = await fetch(`${AGENT_BACKEND_URL}/v3/credits/topup`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-wallet-address': wallet.address,
        },
        body: JSON.stringify({ tx_hash: hash, pack_usdc: pack }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);

      onSuccess();
      onClose();
    } catch (e: any) {
      // viem errors expose `shortMessage`; Privy wallet errors `message`.
      setErr(e?.shortMessage ?? e?.message ?? String(e));
    } finally {
      setBusy(null);
      setStatus('');
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="glass-panel w-full max-w-md rounded-xl border border-outline-variant/40 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-headline text-xl font-bold">Top up credits</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-on-surface-variant hover:text-on-surface"
          >
            ✕
          </button>
        </div>
        <p className="mb-4 text-sm text-on-surface-variant">
          1 credit = $1 USDC on Arbitrum Sepolia. Pay once, run agents until your balance runs out.
        </p>
        {!cfg && (
          <p className="mb-2 text-xs text-on-surface-variant">Loading payment options…</p>
        )}
        {cfg && !cfg.enabled && (
          <p role="alert" className="mb-2 text-sm text-amber-500">
            Credit system is not enabled on the API yet.
          </p>
        )}
        {cfg && cfg.enabled && !cfg.payout_address && (
          <p role="alert" className="mb-2 text-sm text-amber-500">
            Platform payout wallet not configured — contact admin.
          </p>
        )}
        <div className="grid grid-cols-3 gap-3">
          {(cfg?.packs ?? [25, 50, 100]).map((p) => (
            <button
              key={p}
              type="button"
              disabled={busy !== null || !cfg?.enabled || !cfg?.payout_address}
              onClick={() => buy(p)}
              className="rounded-lg border border-outline-variant/40 px-4 py-6 text-center transition-colors hover:border-primary/60 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <div className="font-headline text-2xl font-bold">${p}</div>
              <div className="font-mono text-[11px] uppercase tracking-wider text-on-surface-variant">
                {busy === p ? 'paying…' : 'USDC'}
              </div>
            </button>
          ))}
        </div>
        {status && (
          <p className="mt-4 font-mono text-[11px] text-on-surface-variant">{status}</p>
        )}
        {err && (
          <p role="alert" className="mt-3 text-sm text-amber-500">
            {err}
          </p>
        )}
      </div>
    </div>
  );
}
