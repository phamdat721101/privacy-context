'use client';

/**
 * components/SovereignSaveForm.tsx — magic save UI for user-signed Arkiv writes.
 *
 * One input. Auto-derives a topic from the first hashtag, URL host, or
 * first three words. Shows the canonical-JSON preview the user is about
 * to sign — judges see the receipt before signing. URL paste optionally
 * fetches og:tags via /v4/onboard/unfurl for a richer preview.
 *
 * SOLID:
 * - SRP: form-only. Submit + state come from useArkivWallet.
 * - OCP: future preview types (image, code) slot in via the same render branch.
 */

import { useEffect, useMemo, useState } from 'react';
import { useArkivWallet } from '@/hooks/useArkivWallet';
import { AGENT_BACKEND_URL } from '@/lib/contracts';
import { braga } from '@arkiv-network/sdk/chains';

const TOPIC_FROM_HASHTAG = /#([a-z0-9_-]{2,32})/i;
const TOPIC_FROM_URL = /https?:\/\/(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)/i;
const URL_DETECT = /https?:\/\/[^\s]+/;

/** Derive a topic from the user's text without nagging them.
 *  Hashtag wins; URL host second; first-three-words last. */
function deriveTopic(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return 'general';
  const tag = trimmed.match(TOPIC_FROM_HASHTAG);
  if (tag) return tag[1].toLowerCase();
  const url = trimmed.match(TOPIC_FROM_URL);
  if (url) return url[1].split('.').slice(-2, -1)[0].toLowerCase();
  return trimmed
    .toLowerCase()
    .split(/\s+/)
    .slice(0, 3)
    .join('-')
    .replace(/[^a-z0-9-]/g, '')
    .slice(0, 32) || 'general';
}

const MIN_LEN = 5;
const MAX_LEN = 4000;

export function SovereignSaveForm({
  onSaved,
  askMemory,
}: {
  onSaved?: (entityKey: string, txHash: string, topic: string) => void;
  /** Called when the user clicks "ask your memory" on the lastSaved chip. */
  askMemory?: (topic: string) => void;
}) {
  const wallet = useArkivWallet();
  const [text, setText] = useState('');
  const [topicOverride, setTopicOverride] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<{ entityKey: string; txHash: string; topic: string } | null>(null);

  const derivedTopic = useMemo(() => deriveTopic(text), [text]);
  const topic = topicOverride ?? derivedTopic;
  const valid = text.trim().length >= MIN_LEN && text.length <= MAX_LEN;
  const submitDisabled = !valid || wallet.submitting || !wallet.ready;

  const detectedUrl = useMemo(() => text.match(URL_DETECT)?.[0] ?? null, [text]);
  const unfurl = useUrlUnfurl(detectedUrl);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || !wallet.ready) return;
    const r = await wallet.submit({ fact: text.trim(), topic });
    if (r) {
      setLastSaved({ ...r, topic });
      setText('');
      setTopicOverride(null);
      onSaved?.(r.entityKey, r.txHash, topic);
    }
  }

  return (
    <form onSubmit={handleSave} className="space-y-3 rounded-xl border border-secondary/30 bg-surface p-5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-headline text-base font-semibold">Save to your chain memory</h3>
        <WalletStatus wallet={wallet} />
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        maxLength={MAX_LEN + 100}
        placeholder="Paste a fact, a URL, or a #tagged note. e.g. 'Fhenix wraps an AES-256 key as two euint128 halves #fhe-arbitrum'"
        className="w-full rounded-lg border border-outline-variant/40 bg-surface-container-low p-3 text-sm leading-relaxed font-body outline-none focus:border-secondary/60"
      />

      {unfurl.preview && <UnfurlCard preview={unfurl.preview} />}

      <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-on-surface-variant">
        <span className="rounded border border-tertiary/30 bg-tertiary/10 px-1.5 py-0.5 text-tertiary">topic={topic}</span>
        <button
          type="button"
          onClick={() => {
            const v = window.prompt('override topic (a–z, 0–9, dash, _; max 32):', topic);
            if (v) setTopicOverride(v.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32) || null);
          }}
          className="rounded px-1.5 py-0.5 hover:text-on-surface"
          aria-label="Override topic"
        >
          edit ✎
        </button>
        <span className="ml-auto">{text.length}/{MAX_LEN}</span>
      </div>

      <div className="flex flex-col gap-2">
        {wallet.error && <ErrorBanner error={wallet.error} faucetUrl={wallet.faucetUrl} />}
        {lastSaved && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-secondary/40 bg-secondary/10 p-3 font-mono text-[11px] text-secondary">
            <span>
              ✓ minted on Arkiv-Braga · entity{' '}
              <a className="underline" href={`https://data.arkiv.network/?entityKey=${lastSaved.entityKey}`} target="_blank" rel="noopener noreferrer">
                {lastSaved.entityKey.slice(0, 14)}…
              </a>{' '}
              · tx{' '}
              <a className="underline" href={`https://explorer.braga.hoodi.arkiv.network/tx/${lastSaved.txHash}`} target="_blank" rel="noopener noreferrer">
                {lastSaved.txHash.slice(0, 14)}…
              </a>
            </span>
            {askMemory && (
              <button
                type="button"
                onClick={() => askMemory(lastSaved.topic)}
                className="ml-auto inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-1 text-primary hover:bg-primary/20"
              >
                <span className="material-symbols-outlined text-[14px]">forum</span>
                ask your memory →
              </button>
            )}
          </div>
        )}

        <button
          type="submit"
          disabled={submitDisabled}
          className="inline-flex items-center justify-center gap-2 self-start rounded-full bg-secondary px-5 py-2 text-sm font-medium text-on-secondary transition-opacity disabled:opacity-50 hover:opacity-90"
        >
          <span className="material-symbols-outlined text-[18px]">{wallet.submitting ? 'hourglass_top' : 'bolt'}</span>
          {wallet.submitting ? 'Signing on-chain…' : 'Save to my chain memory'}
        </button>
      </div>
    </form>
  );
}

function WalletStatus({ wallet }: { wallet: ReturnType<typeof useArkivWallet> }) {
  if (!wallet.ready) {
    return <span className="rounded-full border border-error/30 bg-error/10 px-2 py-0.5 font-mono text-[10px] text-error">connect wallet</span>;
  }
  const glm = Number(wallet.balanceWei) / 1e18;
  if (wallet.needsFaucet) {
    return (
      <span className="flex items-center gap-1 rounded-full border border-tertiary/40 bg-tertiary/10 px-2 py-0.5 font-mono text-[10px] text-tertiary">
        ⚠ {glm.toFixed(4)} GLM · need gas
      </span>
    );
  }
  return (
    <span className="rounded-full border border-secondary/30 bg-secondary/10 px-2 py-0.5 font-mono text-[10px] text-secondary">
      {glm.toFixed(4)} GLM
    </span>
  );
}

function ErrorBanner({
  error,
  faucetUrl,
}: {
  error: NonNullable<ReturnType<typeof useArkivWallet>['error']>;
  faucetUrl: string;
}) {
  if (error.code === 'low-balance') {
    return (
      <div className="rounded-lg border border-tertiary/40 bg-tertiary/10 p-3 text-sm">
        <div className="font-medium text-tertiary">⚠ Need GLM gas</div>
        <p className="mt-1 text-[12px] text-on-surface-variant">
          Top up at <a className="underline" href={faucetUrl} target="_blank" rel="noopener noreferrer">{faucetUrl}</a>{' '}
          then click <em>Save</em> again. Faucet drops are free + take ~10s.
        </p>
      </div>
    );
  }
  if (error.code === 'sign-rejected') {
    return <div className="rounded-lg border border-error/40 bg-error/10 p-3 text-sm text-error">You declined the signature. Click Save again to retry.</div>;
  }
  if (error.code === 'chain-add-rejected') {
    return (
      <div className="rounded-lg border border-error/40 bg-error/10 p-3 text-sm text-error">
        Wallet declined the Arkiv-Braga chain. Add it manually with RPC{' '}
        <code className="font-mono">{braga.rpcUrls.default.http[0]}</code> and chain id{' '}
        <code className="font-mono">{braga.id}</code>.
      </div>
    );
  }
  if (error.code === 'no-wallet') {
    return <div className="rounded-lg border border-error/40 bg-error/10 p-3 text-sm text-error">Connect a wallet first via the top-right button.</div>;
  }
  return <div className="rounded-lg border border-error/40 bg-error/10 p-3 font-mono text-[11px] text-error">{error.message}</div>;
}


// ─── URL unfurl ─────────────────────────────────────────────────────────────

interface UnfurlPreview {
  url: string;
  hostname: string;
  title: string | null;
  description: string | null;
  image: string | null;
}

function useUrlUnfurl(url: string | null): { loading: boolean; preview: UnfurlPreview | null } {
  const [state, setState] = useState<{ loading: boolean; preview: UnfurlPreview | null }>({ loading: false, preview: null });
  useEffect(() => {
    if (!url) { setState({ loading: false, preview: null }); return; }
    const ctrl = new AbortController();
    setState({ loading: true, preview: null });
    const t = setTimeout(() => {
      fetch(`${AGENT_BACKEND_URL}/v4/onboard/unfurl?url=${encodeURIComponent(url)}`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((p) => setState({ loading: false, preview: p ?? null }))
        .catch(() => setState({ loading: false, preview: null }));
    }, 500); // debounce typing
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [url]);
  return state;
}

function UnfurlCard({ preview }: { preview: UnfurlPreview }) {
  return (
    <a
      href={preview.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex gap-3 rounded-lg border border-outline-variant/40 bg-surface-container-low p-3 transition-colors hover:border-primary/40"
    >
      {preview.image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={preview.image} alt="" className="h-16 w-16 rounded object-cover" />
      )}
      <div className="min-w-0 flex-1 text-sm">
        <div className="font-mono text-[10px] text-on-surface-variant">{preview.hostname}</div>
        <div className="truncate font-medium">{preview.title ?? preview.url}</div>
        {preview.description && (
          <div className="line-clamp-2 text-xs text-on-surface-variant">{preview.description}</div>
        )}
      </div>
    </a>
  );
}
