'use client';

/**
 * /connect-mcp — MCP setup wizard.
 *
 * Three-step flow that produces a personalized `mcp.json` snippet for the
 * user's chosen MCP host. Mirrors the mem-ui `openx_mcp_setup_wizard`
 * prototype.
 *
 * Sui-only — wrapped in `<RequireSuiNetwork>` (already enforced by the nav
 * item visibility, but the route guard makes deep-links honest too).
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { RequireSuiNetwork } from '@/components/RequireSuiNetwork';

type Host = 'cursor' | 'claude-desktop' | 'claude-code' | 'codex' | 'other';
type Mode = 'openx-bound' | 'memwal-direct' | 'hybrid';

const HOST_PATHS: Record<Host, string> = {
  cursor: '~/.cursor/mcp.json',
  'claude-desktop': '~/Library/Application Support/Claude/claude_desktop_config.json',
  'claude-code': '~/.claude/mcp.json',
  codex: '~/.codex/mcp.json',
  other: '<host-config-path>',
};

const HOST_LABELS: Record<Host, string> = {
  cursor: 'Cursor',
  'claude-desktop': 'Claude Desktop',
  'claude-code': 'Claude Code',
  codex: 'Codex',
  other: 'Other',
};

const HOST_ICONS: Record<Host, string> = {
  cursor: 'terminal',
  'claude-desktop': 'desktop_windows',
  'claude-code': 'code',
  codex: 'memory',
  other: 'more_horiz',
};

const MODE_LABELS: Record<Mode, { title: string; sub: string; recommended?: boolean }> = {
  'openx-bound': {
    title: 'OpenX-bound',
    sub: 'All MemWal calls route through OpenX — operator pool holds delegates. No keys on this machine.',
    recommended: true,
  },
  'memwal-direct': {
    title: 'MemWal-direct (power user)',
    sub: 'Direct to MemWal relayer using ~/.memwal/credentials.json.',
  },
  hybrid: {
    title: 'Hybrid',
    sub: 'Tool-prefix split — openx_memwal_* via OpenX, memwal_* direct.',
  },
};

export default function ConnectMcpPage() {
  return (
    <RequireSuiNetwork
      title="Connect your AI agent to OpenX"
      description="Switch to Sui to generate the MCP config that lets Cursor, Claude, and Codex query your paid brains."
    >
      <ConnectMcpInner />
    </RequireSuiNetwork>
  );
}

function ConnectMcpInner() {
  const [host, setHost] = useState<Host>('cursor');
  const [mode, setMode] = useState<Mode>('openx-bound');

  const apiUrl =
    typeof window !== 'undefined'
      ? process.env.NEXT_PUBLIC_AGENT_BACKEND_URL ?? 'http://localhost:3001'
      : 'http://localhost:3001';

  // Build the snippet. The hosted gateway lives at /v3/memory + /mcp; the bin
  // path is the local stdio shim for users that prefer subprocess transport.
  const snippet = useMemo(() => {
    const base = {
      mcpServers: {
        openx: {
          command: 'npx',
          args: ['-y', '@openx/mcp'],
          env: {
            OPENX_API_URL: apiUrl,
            OPENX_MCP_AUTH_MODE: mode,
          } as Record<string, string>,
        },
      },
    };
    if (mode === 'memwal-direct') {
      base.mcpServers.openx.env.MEMWAL_PEERDEP_ENABLED = 'true';
    }
    return JSON.stringify(base, null, 2);
  }, [mode, apiUrl]);

  function copy() {
    navigator.clipboard?.writeText(snippet).catch(() => undefined);
  }

  function download() {
    const blob = new Blob([snippet], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `openx-mcp.${host}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 py-6">
      <header className="border-b border-outline-variant/30 pb-4">
        <h1 className="font-headline text-2xl font-bold text-primary">
          Connect your AI agent to OpenX
        </h1>
        <p className="mt-2 text-sm text-on-surface-variant">
          Configure Model Context Protocol (MCP) so your agent can query
          paid OpenX brains, store memories under your Walrus account, and
          surface three-proof attestations on every response.
        </p>
      </header>

      {/* Step 1 — host */}
      <section className="space-y-3">
        <Step n="01" title="Select environment" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {(Object.keys(HOST_LABELS) as Host[]).map((h) => (
            <button
              key={h}
              onClick={() => setHost(h)}
              className={`relative flex flex-col items-center justify-center gap-2 rounded-lg border p-4 transition ${
                host === h
                  ? 'border-primary bg-primary/5 shadow-glow-cyan'
                  : 'border-outline-variant/40 bg-surface-container-low/60 opacity-70 hover:opacity-100'
              }`}
            >
              <span className="material-symbols-outlined text-primary text-[24px]">
                {HOST_ICONS[h]}
              </span>
              <span className="text-center font-mono text-[11px] uppercase tracking-wider">
                {HOST_LABELS[h]}
              </span>
              {host === h && (
                <span className="material-symbols-outlined absolute right-2 top-2 text-primary text-[16px]">
                  check_circle
                </span>
              )}
            </button>
          ))}
        </div>
      </section>

      {/* Step 2 — mode */}
      <section className="space-y-3">
        <Step n="02" title="Connection topology" />
        <div className="space-y-2">
          {(Object.keys(MODE_LABELS) as Mode[]).map((m) => {
            const info = MODE_LABELS[m];
            const active = mode === m;
            return (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`flex w-full items-start gap-3 rounded-lg border p-4 text-left transition ${
                  active
                    ? 'border-primary bg-primary/5'
                    : 'border-outline-variant/40 bg-surface-container-low/60 hover:border-outline'
                }`}
              >
                <input
                  type="radio"
                  readOnly
                  checked={active}
                  className="mt-1 h-4 w-4 accent-primary"
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-base text-on-surface">{info.title}</span>
                    {info.recommended && (
                      <span className="rounded-sm border border-primary/40 bg-primary/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-primary">
                        recommended
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-on-surface-variant">{info.sub}</p>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Step 3 — snippet */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <Step n="03" title="Inject configuration" />
          <span className="font-mono text-[11px] text-on-surface-variant">{HOST_PATHS[host]}</span>
        </div>
        <div className="overflow-hidden rounded-lg border border-outline-variant/40 bg-black">
          <pre className="overflow-x-auto p-4 font-mono text-xs text-on-surface">
            <code>{snippet}</code>
          </pre>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={copy}
            className="inline-flex items-center gap-2 rounded-lg border border-outline-variant/40 bg-surface-container-low/60 px-4 py-2 text-sm hover:border-primary/60"
          >
            <span className="material-symbols-outlined text-[18px]">content_copy</span>
            Copy
          </button>
          <button
            onClick={download}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-on-primary"
          >
            <span className="material-symbols-outlined text-[18px]">download</span>
            Download
          </button>
          <Link
            href="/dashboard/mcp"
            className="inline-flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/10 px-4 py-2 text-sm text-primary hover:bg-primary/20"
          >
            <span className="material-symbols-outlined text-[18px]">monitor_heart</span>
            View live MCP activity →
          </Link>
        </div>
        <p className="text-xs text-outline">
          After dropping this into <span className="font-mono">{HOST_PATHS[host]}</span>, restart
          your agent host. The first call to any <span className="font-mono">memwal_*</span> tool
          on a Sui-connected wallet will surface its three-proof attestation in the response.
        </p>
      </section>
    </div>
  );
}

function Step({ n, title }: { n: string; title: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="rounded-sm border border-secondary/40 bg-secondary/5 px-2 py-1 font-mono text-[10px] tracking-wider text-secondary">
        {n}
      </span>
      <h2 className="font-headline text-lg">{title}</h2>
    </div>
  );
}
