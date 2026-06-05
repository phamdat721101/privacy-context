'use client';

/**
 * /dashboard/mcp — Live MCP activity feed.
 *
 * Streams the buyer's most recent paid queries as a scrolling list. Each
 * row links to the three-proof verifier so the user can independently
 * audit the call. Polls /v3/memory/buyer/activity every 5 seconds.
 *
 * Sui-only — wraps in <RequireSuiNetwork>.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useActiveWallet } from '@/hooks/useActiveWallet';
import { RequireSuiNetwork } from '@/components/RequireSuiNetwork';
import { AGENT_BACKEND_URL } from '@/lib/contracts';

interface Activity {
  id: string;
  brain_sui_object_id: string;
  amount_usdc: string;
  payment_rail: string;
  payment_tx_hash: string;
  settlement_tx_hash: string | null;
  refunded: boolean;
  phala_attestation_hash: string | null;
  ms_elapsed: number | null;
  created_at: string;
  title: string | null;
  namespace: string | null;
  cognitive_level: number | null;
  attestation_required: number | null;
}

export default function McpDashboardPage() {
  return (
    <RequireSuiNetwork
      title="MCP activity is Sui-only"
      description="Switch to Sui to see live paid queries from your agents."
    >
      <McpDashboardInner />
    </RequireSuiNetwork>
  );
}

function McpDashboardInner() {
  const { address } = useActiveWallet();
  const [rows, setRows] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!address) return;
    let alive = true;
    const tick = () => {
      fetch(`${AGENT_BACKEND_URL}/v3/memory/buyer/activity?limit=50`, {
        headers: { 'x-wallet-address': address, 'x-chain': 'sui' },
      })
        .then((r) => (r.ok ? r.json() : { activity: [] }))
        .then((j) => {
          if (alive) {
            setRows(j.activity ?? []);
            setLoading(false);
          }
        })
        .catch(() => alive && setLoading(false));
    };
    tick();
    const id = setInterval(tick, 5_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [address]);

  return (
    <div className="space-y-6">
      <header className="border-b border-outline-variant/30 pb-4">
        <h1 className="font-headline text-2xl font-bold">MCP Activity</h1>
        <p className="mt-1 text-sm text-on-surface-variant">
          Live feed of paid MemWal queries from your connected agents. Click any
          row to inspect its three-proof attestation.
        </p>
      </header>

      {!address ? (
        <p className="rounded-lg border border-outline-variant/40 bg-surface-container-low/60 p-6 text-sm text-on-surface-variant">
          Connect a wallet to see your activity.
        </p>
      ) : loading ? (
        <p className="py-12 text-center text-on-surface-variant">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-outline-variant/40 bg-surface-container-low/60 p-8 text-center">
          <p className="text-on-surface-variant">No paid queries yet.</p>
          <Link
            href="/connect-mcp"
            className="mt-3 inline-block text-sm text-primary hover:underline"
          >
            Connect your agent →
          </Link>
        </div>
      ) : (
        <ul className="divide-y divide-outline-variant/30 rounded-lg border border-outline-variant/40 bg-surface-container-low/60 backdrop-blur">
          {rows.map((r) => (
            <li key={r.id}>
              <a
                href={`https://suiscan.xyz/testnet/tx/${encodeURIComponent(r.payment_tx_hash)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="grid grid-cols-1 gap-2 p-4 transition hover:bg-primary/5 md:grid-cols-[2fr_1fr_1fr_1fr_auto]"
              >
                <div>
                  <p className="font-headline text-sm text-on-surface line-clamp-1">
                    {r.title ?? r.brain_sui_object_id.slice(0, 10) + '…'}
                  </p>
                  <p className="font-mono text-[11px] text-outline">
                    namespace: {r.namespace ?? '—'}
                  </p>
                </div>
                <div className="font-mono text-xs text-on-surface-variant">
                  ${Number(r.amount_usdc).toFixed(4)}
                  <span className="ml-2 text-outline">{r.payment_rail}</span>
                </div>
                <div className="font-mono text-xs">
                  {r.refunded ? (
                    <span className="text-error">refunded</span>
                  ) : r.settlement_tx_hash ? (
                    <span className="text-secondary">settled</span>
                  ) : (
                    <span className="text-amber-300">pending</span>
                  )}
                </div>
                <div className="font-mono text-[11px] text-outline">
                  {new Date(r.created_at).toLocaleTimeString()}
                </div>
                <span className="material-symbols-outlined self-center text-on-surface-variant text-[18px]">
                  arrow_forward
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
