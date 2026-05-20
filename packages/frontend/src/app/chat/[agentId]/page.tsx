'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { usePrivy } from '@privy-io/react-auth';
import { useChat } from '@/hooks/useChat';
import { usePermit } from '@/hooks/usePermit';
import { PermitManager } from '@/components/PermitManager';
import { ChatBubble } from '@/components/ChatBubble';
import { getAgent, type Agent } from '@/lib/agents';

export default function ChatAgentPage() {
  const params = useParams<{ agentId: string }>();
  const agentId = params?.agentId;
  const { authenticated, ready, user, login } = usePrivy();
  const userAddress = user?.wallet?.address as `0x${string}` | undefined;
  const [agent, setAgent] = useState<Agent | null>(null);
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<'learn' | 'store'>('learn');

  const {
    permitState,
    reason,
    authorize,
    revoke,
    forceUnauthorized,
    loading: permitLoading,
    error: permitError,
  } = usePermit(userAddress);
  const { messages, sendMessage, loading, error, needsSubscription } = useChat(
    userAddress,
    forceUnauthorized,
  );

  const isPermitted = !!permitState.serializedPermit;
  const isOwner =
    !!agent && !!userAddress && agent.ownerAddress.toLowerCase() === userAddress.toLowerCase();

  useEffect(() => {
    if (agentId) getAgent(agentId).then(setAgent);
  }, [agentId]);

  async function handleSend() {
    if (!input.trim() || loading || !agentId) return;
    const m = input.trim();
    setInput('');
    await sendMessage(m, agentId, isOwner ? mode : 'learn');
  }

  if (!ready) return null;

  if (!authenticated) {
    return (
      <div className="space-y-4 py-20 text-center">
        <h1 className="font-headline text-2xl font-bold">Connect to chat</h1>
        <p className="text-on-surface-variant">You need a wallet to hire an agent.</p>
        <button
          onClick={login}
          className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-3 font-medium text-on-primary"
        >
          Connect wallet
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-9rem)] flex-col gap-4">
      {/* Header strip */}
      <div className="flex items-center justify-between gap-3 rounded-xl border border-outline-variant/30 bg-surface px-4 py-3">
        <div className="flex items-center gap-3">
          <Link
            href={`/agent/${agentId}`}
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors hover:bg-primary/20"
            aria-label="Back to agent profile"
          >
            <span className="material-symbols-outlined text-[18px]">arrow_back</span>
          </Link>
          <div className="min-w-0">
            <div className="truncate font-headline text-sm font-semibold">
              {agent?.title ?? `Agent #${agentId}`}
            </div>
            <div className="font-mono text-[11px] text-on-surface-variant">
              🔒 Encrypted via Fhenix CoFHE
            </div>
          </div>
        </div>
        {isOwner && (
          <div className="flex rounded-full border border-outline-variant/30 bg-surface-container-high p-1">
            {(['learn', 'store'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`rounded-full px-3 py-1 font-mono text-[11px] uppercase transition-colors ${
                  mode === m ? 'bg-primary text-on-primary' : 'text-on-surface-variant'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Inline permit gate — appears whenever the API rejects with 403 */}
      {!isPermitted && userAddress && (
        <PermitManager
          permitState={permitState}
          authorize={authorize}
          revoke={revoke}
          loading={permitLoading}
          error={permitError}
          reason={reason}
        />
      )}

      {/* Messages */}
      <div className="flex-1 space-y-4 overflow-y-auto rounded-xl border border-outline-variant/30 bg-surface-container-low p-4">
        {needsSubscription && (
          <div className="rounded-lg border border-tertiary/30 bg-tertiary/10 p-3 text-sm text-tertiary">
            Subscription required.{' '}
            <Link href="/settings" className="underline">
              Subscribe →
            </Link>
          </div>
        )}
        {error && !needsSubscription && (
          <div className="rounded-lg border border-error/30 bg-error/10 p-3 text-sm text-error">
            {error}
          </div>
        )}
        {messages.length === 0 && isPermitted && !loading && (
          <div className="py-12 text-center text-sm text-on-surface-variant">
            Start by asking the agent something.
          </div>
        )}
        {messages.map((m, i) => (
          <ChatBubble key={i} role={m.role}>
            {m.content}
          </ChatBubble>
        ))}
        {loading && (
          <ChatBubble role="assistant" attestation={false}>
            <span className="animate-pulse text-on-surface-variant">Thinking…</span>
          </ChatBubble>
        )}
      </div>

      {/* Composer */}
      <div className="rounded-xl border border-outline-variant/30 bg-surface p-3">
        <div className="flex items-center gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder={
              isPermitted ? `Ask ${agent?.title ?? 'this agent'}…` : 'Authorize FHE permit to chat'
            }
            disabled={!isPermitted || loading}
            className="flex-1 rounded-full bg-surface-container-low px-4 py-2 text-sm text-on-surface placeholder:text-on-surface-variant focus:outline-none disabled:opacity-50"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || loading || !isPermitted}
            className="rounded-full bg-primary p-2.5 text-on-primary transition-colors hover:bg-primary/90 disabled:opacity-50"
            aria-label="Send"
          >
            <span className="material-symbols-outlined text-[18px]">send</span>
          </button>
        </div>
      </div>
    </div>
  );
}
