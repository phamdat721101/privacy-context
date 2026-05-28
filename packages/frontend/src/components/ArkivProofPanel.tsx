'use client';

/**
 * ArkivProofPanel — the demo's "verify-without-trusting-OpenX" moment.
 *
 * Behavior:
 *   - Floating button (fixed bottom-right). Click → slide-up overlay.
 *   - Twin iframes: Arkiv block explorer (left) + data.arkiv.network (right),
 *     both filtered to our PROJECT_ATTRIBUTE.
 *   - "Copy verify-script" button drops a one-liner curl + a tiny
 *     `createPublicClient` snippet judges can paste into a Node REPL.
 *
 * The component is self-contained — AppShell just renders <ArkivProofPanel />
 * once. No external state, no context.
 */

import { useState } from 'react';
import {
  ARKIV_BLOCK_EXPLORER,
  ARKIV_DATA_EXPLORER,
  ARKIV_PROJECT_ATTRIBUTE,
  ARKIV_BACKEND_WALLET,
  ARKIV_RPC_URL,
} from '@/lib/arkiv';

/**
 * Two clipboard payloads, one per surface:
 *   - DSL_QUERY  → paste into data.arkiv.network's query box (right pane).
 *                  Uses Arkiv's SQL-like attribute language.
 *   - NODE_SNIPPET → paste into a Node 20+ REPL with `@arkiv-network/sdk`
 *                    installed. Uses the JS SDK's `createPublicClient`.
 * Same data, two surfaces. Either path proves the platform is irrelevant
 * to verification — the explorers and SDK both read directly from chain.
 */
const DSL_QUERY = `project = "${ARKIV_PROJECT_ATTRIBUTE}" && entityType = "agent-memory"`;

const DSL_DECISIONS_QUERY = `project = "${ARKIV_PROJECT_ATTRIBUTE}" && entityType = "agent-decision"`;

const NODE_SNIPPET = `// Verify any OpenX memory yourself — no OpenX server required.
import { createPublicClient, http } from '@arkiv-network/sdk';
import { braga } from '@arkiv-network/sdk/chains';
import { eq } from '@arkiv-network/sdk/query';

const c = createPublicClient({ chain: braga, transport: http('${ARKIV_RPC_URL}') });
const r = await c.buildQuery()
  .where([
    eq('project', '${ARKIV_PROJECT_ATTRIBUTE}'),
    eq('entityType', 'agent-memory'),
    eq('$creator', '${ARKIV_BACKEND_WALLET || '0xYOUR_BACKEND_WALLET'}'),
  ])
  .withPayload(true).withAttributes(true).withMetadata(true).limit(20).fetch();
console.log(JSON.stringify(r.entities, null, 2));
`;

export function ArkivProofPanel() {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<'dsl' | 'decisions' | 'node' | null>(null);

  const dataUrl = ARKIV_BACKEND_WALLET
    ? `${ARKIV_DATA_EXPLORER}?owner=${ARKIV_BACKEND_WALLET}`
    : ARKIV_DATA_EXPLORER;

  async function copy(kind: 'dsl' | 'decisions' | 'node'): Promise<void> {
    const payload = kind === 'dsl' ? DSL_QUERY : kind === 'decisions' ? DSL_DECISIONS_QUERY : NODE_SNIPPET;
    try {
      await navigator.clipboard.writeText(payload);
      setCopied(kind);
      setTimeout(() => setCopied(null), 1500);
    } catch {/* ignore */}
  }

  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-20 right-4 z-50 inline-flex items-center gap-2 rounded-full border border-secondary/40 bg-secondary/10 px-4 py-2 font-mono text-xs text-secondary shadow-lg backdrop-blur transition-all hover:bg-secondary/20 md:bottom-6"
        aria-label="Open Arkiv proof panel"
      >
        <span className="material-symbols-outlined text-[16px]">shield_lock</span>
        verify on arkiv
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-x-0 bottom-0 z-[60] h-[70vh] border-t border-outline-variant/30 bg-surface shadow-2xl md:inset-x-4 md:bottom-4 md:rounded-2xl"
        >
          <div className="flex h-12 items-center justify-between gap-3 border-b border-outline-variant/30 px-4">
            <div className="flex min-w-0 items-center gap-2 font-mono text-xs">
              <span className="material-symbols-outlined text-[16px] text-secondary">shield_lock</span>
              <span className="truncate">independent verification — both explorers below are NOT OpenX&apos;s</span>
              <span className="rounded border border-secondary/30 bg-secondary/10 px-1.5 py-0.5 text-[10px] uppercase tracking-widest text-secondary">arkiv-braga</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => copy('dsl')}
                className="inline-flex items-center gap-1 rounded-full border border-outline-variant/30 px-2 py-1 font-mono text-[11px] hover:border-secondary/40"
                aria-label="Copy Arkiv DSL query for memories (paste into the right-pane query box)"
                title="Paste into the data.arkiv.network query box on the right →"
              >
                <span className="material-symbols-outlined text-[14px]">{copied === 'dsl' ? 'check' : 'memory'}</span>
                {copied === 'dsl' ? 'copied' : 'memories DSL'}
              </button>
              <button
                onClick={() => copy('decisions')}
                className="inline-flex items-center gap-1 rounded-full border border-outline-variant/30 px-2 py-1 font-mono text-[11px] hover:border-tertiary/40"
                aria-label="Copy Arkiv DSL query for the agent-decision reputation log"
                title="Paste into the data.arkiv.network query box → reveals the agent-decision entity log"
              >
                <span className="material-symbols-outlined text-[14px]">{copied === 'decisions' ? 'check' : 'history'}</span>
                {copied === 'decisions' ? 'copied' : 'decisions DSL'}
              </button>
              <button
                onClick={() => copy('node')}
                className="inline-flex items-center gap-1 rounded-full border border-outline-variant/30 px-2 py-1 font-mono text-[11px] hover:border-primary/40"
                aria-label="Copy Node createPublicClient script (paste into a terminal)"
                title="Paste into a Node REPL or .ts file"
              >
                <span className="material-symbols-outlined text-[14px]">{copied === 'node' ? 'check' : 'terminal'}</span>
                {copied === 'node' ? 'copied' : 'node script'}
              </button>
              <button onClick={() => setOpen(false)} className="rounded p-1 hover:bg-surface-container" aria-label="Close">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
          </div>

          <div className="grid h-[calc(70vh-3rem)] grid-cols-1 gap-px bg-outline-variant/30 md:grid-cols-2">
            <Frame title="Block explorer (Arkiv-Braga)" src={ARKIV_BLOCK_EXPLORER} />
            <Frame title={`data.arkiv.network · project=${ARKIV_PROJECT_ATTRIBUTE}`} src={dataUrl} />
          </div>
        </div>
      )}
    </>
  );
}

function Frame({ title, src }: { title: string; src: string }) {
  return (
    <div className="flex min-h-0 flex-col bg-surface">
      <div className="flex items-center justify-between border-b border-outline-variant/30 px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-on-surface-variant">
        <span>{title}</span>
        <a href={src} target="_blank" rel="noopener noreferrer" className="hover:text-primary" aria-label="Open in new tab">
          ↗
        </a>
      </div>
      <iframe src={src} className="min-h-0 flex-1" sandbox="allow-scripts allow-same-origin allow-popups" referrerPolicy="no-referrer" />
    </div>
  );
}
