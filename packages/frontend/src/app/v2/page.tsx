'use client';
/**
 * Showcase route — `/v2` — demonstrates the new design system end-to-end.
 *
 * Single page with in-page navigation between the 5 main screens
 * (Home / Chat / Catalog / Subscribe / MyBrain). Uses the design system from
 * `packages/ui` exclusively; mock client state lives in React useState.
 *
 * Why one page instead of five: keeps the demo URL stable for grant
 * submissions and avoids touching the legacy retro pages until they're
 * retired post-v1.0.
 */
import { useMemo, useState } from 'react';
import {
  Badge,
  BottomNav,
  BrainCard,
  Button,
  Card,
  ChainTierPicker,
  ChatBubble,
  Input,
  KYABadge,
  MigrationStepper,
  Modal,
  Stepper,
  Textarea,
  Toast,
  WalletPill,
} from '@fhe-ai-context/ui';
import type { ChainTier } from '@fhe-ai-context/sdk';

type Screen = 'home' | 'chat' | 'catalog' | 'subscribe' | 'mybrain';
type ChatMode = 'learn' | 'store';

interface UiBrain {
  id: number;
  title: string;
  description: string;
  tags: string[];
  tier: ChainTier;
  chunks: number;
  owner: string;
  published: boolean;
}

const SAMPLE_BRAINS: UiBrain[] = [
  {
    id: 1,
    title: 'Solidity Security Best Practices',
    description: 'Reentrancy, access control, oracle manipulation. Distilled from OpenZeppelin docs.',
    tags: ['solidity', 'security', 'audit'],
    tier: 'trustless',
    chunks: 47,
    owner: '0xAb3...c0d',
    published: true,
  },
  {
    id: 2,
    title: 'FHE Explained',
    description: 'Fully Homomorphic Encryption from zero. Math-light, intuition-heavy.',
    tags: ['fhe', 'crypto'],
    tier: 'standard',
    chunks: 18,
    owner: '0xC0f...fee',
    published: true,
  },
];

export default function ShowcasePage() {
  const [screen, setScreen] = useState<Screen>('home');
  const [tier, setTier] = useState<ChainTier>('standard');
  const [subscribed, setSubscribed] = useState(false);
  const [chatMode, setChatMode] = useState<ChatMode>('learn');
  const [chatHistory, setChatHistory] = useState<
    Array<{ role: 'user' | 'assistant'; content: string; sources?: string[]; verified?: boolean }>
  >([]);
  const [input, setInput] = useState('');
  const [migrationOpen, setMigrationOpen] = useState(false);
  const [migrationStep, setMigrationStep] = useState(0);
  const [toast, setToast] = useState<string | null>(null);

  const navItems = useMemo(
    () => [
      { key: 'home', label: 'Home', icon: '⌂', href: '#home' },
      { key: 'chat', label: 'Chat', icon: '✎', href: '#chat' },
      { key: 'catalog', label: 'Brains', icon: '⌬', href: '#catalog' },
      { key: 'subscribe', label: 'Subscribe', icon: '◈', href: '#subscribe' },
      { key: 'mybrain', label: 'MyBrain', icon: '⊞', href: '#mybrain' },
    ],
    [],
  );

  function send() {
    if (!input.trim()) return;
    const user = { role: 'user' as const, content: input };
    if (chatMode === 'store') {
      setChatHistory((h) => [...h, user, { role: 'assistant', content: 'Stored.' }]);
    } else {
      const assistant = {
        role: 'assistant' as const,
        content: `Mock answer to "${input}" from ${tier === 'trustless' ? 'Phala-attested' : 'Bedrock'} inference. Real LLM kicks in when env is configured.`,
        sources: ['chunk-0', 'chunk-1'],
        verified: tier === 'trustless',
      };
      setChatHistory((h) => [...h, user, assistant]);
    }
    setInput('');
  }

  function startMigration() {
    setMigrationOpen(true);
    setMigrationStep(0);
    let s = 0;
    const interval = setInterval(() => {
      s++;
      setMigrationStep(s);
      if (s >= 4) {
        clearInterval(interval);
        setTimeout(() => {
          setMigrationOpen(false);
          setToast('Migrated to ' + (tier === 'standard' ? 'Trustless' : 'Standard') + '.');
        }, 600);
      }
    }, 700);
  }

  return (
    <main className="min-h-screen bg-background text-on-surface pb-24">
      {/* Header */}
      <header className="sticky top-0 z-40 flex items-center justify-between border-b border-border bg-surface/80 px-4 py-3 backdrop-blur sm:px-8">
        <h1 className="font-bold text-on-surface">FHE Second Brain · Showcase</h1>
        <WalletPill address="0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" chain={tier === 'standard' ? 'fhenix' : 'sui'} />
      </header>

      <div className="mx-auto max-w-5xl space-y-8 px-4 py-8 sm:px-8">
        {/* Tier picker — visible on every screen so it's the primary control */}
        <section>
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-text-muted">Privacy tier</h2>
          <ChainTierPicker value={tier} onChange={setTier} />
        </section>

        {/* Screen body */}
        {screen === 'home' && <HomeScreen tier={tier} subscribed={subscribed} />}
        {screen === 'chat' && (
          <ChatScreen
            tier={tier}
            mode={chatMode}
            onModeChange={setChatMode}
            history={chatHistory}
            input={input}
            onInputChange={setInput}
            onSend={send}
            subscribed={subscribed}
            onPay={() => setScreen('subscribe')}
          />
        )}
        {screen === 'catalog' && <CatalogScreen tier={tier} />}
        {screen === 'subscribe' && (
          <SubscribeScreen
            tier={tier}
            subscribed={subscribed}
            onConfirm={() => {
              setSubscribed(true);
              setToast('Subscribed.');
            }}
          />
        )}
        {screen === 'mybrain' && <MyBrainScreen tier={tier} onMigrate={startMigration} />}
      </div>

      {/* Migration modal */}
      <Modal open={migrationOpen} onClose={() => setMigrationOpen(false)} title="Migrating brain">
        <MigrationStepper current={migrationStep} />
      </Modal>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2">
          <Toast tone="success" onAction={() => setToast(null)} actionLabel="Dismiss">
            {toast}
          </Toast>
        </div>
      )}

      <BottomNav
        items={navItems}
        activeKey={screen}
        renderLink={(item, children) => (
          <a
            href={item.href}
            onClick={(e) => {
              e.preventDefault();
              setScreen(item.key as Screen);
            }}
          >
            {children}
          </a>
        )}
      />
    </main>
  );
}

// ---------- Screens ---------------------------------------------------------

function HomeScreen({ tier, subscribed }: { tier: ChainTier; subscribed: boolean }) {
  return (
    <section className="space-y-6">
      <div className="rounded-lg border border-border bg-card p-6">
        <h1 className="text-2xl font-bold">Your knowledge. Encrypted. Yours.</h1>
        <p className="mt-2 text-on-surface-variant">
          A second brain with cryptographic privacy — for you and the AI agents you trust.
        </p>
        <div className="mt-4 flex gap-2">
          <Badge tone="encrypted">🔒 {tier === 'standard' ? 'Fhenix CoFHE' : 'Seal IBE + Walrus'}</Badge>
          {subscribed ? <Badge tone="success">Subscribed</Badge> : <Badge tone="warning">Not subscribed</Badge>}
          <KYABadge verified reputation={84} />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Card interactive>
          <h3 className="font-semibold text-on-surface">Try the demo brain</h3>
          <p className="mt-1 text-sm text-on-surface-variant">No signup. Sample answers from a public brain.</p>
        </Card>
        <Card interactive>
          <h3 className="font-semibold text-on-surface">Bring your knowledge</h3>
          <p className="mt-1 text-sm text-on-surface-variant">Upload .txt / .md / .csv. Encrypted before it leaves your device.</p>
        </Card>
        <Card interactive>
          <h3 className="font-semibold text-on-surface">Build with the SDK</h3>
          <p className="mt-1 text-sm text-on-surface-variant">npm i @fhe-ai-context/sdk. Cross-chain. Open source.</p>
        </Card>
      </div>
    </section>
  );
}

function ChatScreen(props: {
  tier: ChainTier;
  mode: ChatMode;
  onModeChange: (m: ChatMode) => void;
  history: Array<{ role: 'user' | 'assistant'; content: string; sources?: string[]; verified?: boolean }>;
  input: string;
  onInputChange: (v: string) => void;
  onSend: () => void;
  subscribed: boolean;
  onPay: () => void;
}) {
  if (!props.subscribed) {
    return (
      <section className="rounded-lg border border-border bg-card p-6">
        <h2 className="text-lg font-semibold">Subscribe to chat</h2>
        <p className="mt-1 text-sm text-on-surface-variant">
          {props.tier === 'standard' ? 'Standard $5/mo' : 'Trustless $15/mo'}
        </p>
        <div className="mt-3">
          <Button onClick={props.onPay}>Subscribe</Button>
        </div>
      </section>
    );
  }
  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <Button
          tone={props.mode === 'learn' ? 'primary' : 'ghost'}
          size="sm"
          onClick={() => props.onModeChange('learn')}
        >
          Learn
        </Button>
        <Button
          tone={props.mode === 'store' ? 'success' : 'ghost'}
          size="sm"
          onClick={() => props.onModeChange('store')}
        >
          Store
        </Button>
        <span className="ml-2 text-xs text-text-muted">
          {props.mode === 'learn' ? 'Ask your brain' : 'Type to remember'}
        </span>
      </div>
      <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-container p-3">
        {props.history.length === 0 && (
          <p className="text-center text-sm text-text-muted">Start the conversation. Switch modes any time.</p>
        )}
        {props.history.map((m, i) => (
          <ChatBubble
            key={i}
            role={m.role}
            mode={props.mode}
            sources={m.sources}
            attestation={m.verified !== undefined ? { provider: 'phala-tee', verified: m.verified } : undefined}
          >
            {m.content}
          </ChatBubble>
        ))}
      </div>
      <div className="flex gap-2">
        <Input
          value={props.input}
          onChange={(e) => props.onInputChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') props.onSend();
          }}
          placeholder={props.mode === 'learn' ? 'Ask your brain…' : 'Tell your brain…'}
          className="flex-1"
        />
        <Button onClick={props.onSend} tone={props.mode === 'store' ? 'success' : 'primary'}>
          Send
        </Button>
      </div>
    </section>
  );
}

function CatalogScreen({ tier }: { tier: ChainTier }) {
  const [q, setQ] = useState('');
  const filtered = SAMPLE_BRAINS.filter(
    (b) => !q || b.title.toLowerCase().includes(q.toLowerCase()) || b.tags.some((t) => t.includes(q.toLowerCase())),
  );
  const ofTier = filtered.filter((b) => b.tier === tier);
  return (
    <section className="space-y-4">
      <div className="flex gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search brains…" className="flex-1" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {ofTier.map((b) => (
          <BrainCard
            key={b.id}
            title={b.title}
            description={b.description}
            tags={b.tags}
            chunkCount={b.chunks}
            ownerAddress={b.owner}
            tier={b.tier}
          />
        ))}
        {ofTier.length === 0 && (
          <Card>
            <p className="text-sm text-text-muted">No brains in this tier yet. Try the other tier.</p>
          </Card>
        )}
      </div>
    </section>
  );
}

function SubscribeScreen({
  tier,
  subscribed,
  onConfirm,
}: {
  tier: ChainTier;
  subscribed: boolean;
  onConfirm: () => void;
}) {
  const price = tier === 'standard' ? '$5 / mo' : '$15 / mo';
  return (
    <section className="space-y-4">
      <div className="rounded-lg border border-border bg-card p-6">
        <h2 className="text-lg font-semibold">Subscribe</h2>
        <p className="mt-1 text-sm text-on-surface-variant">
          {tier === 'standard'
            ? 'Standard tier — Fhenix CoFHE on Arbitrum'
            : 'Trustless tier — Seal IBE + Walrus + Phala TEE'}
        </p>
        <p className="mt-3 text-2xl font-bold">{price}</p>
        <div className="mt-4">
          {subscribed ? (
            <Badge tone="success">Active</Badge>
          ) : (
            <Button onClick={onConfirm} tone="primary">
              Confirm
            </Button>
          )}
        </div>
        <details className="mt-4 text-xs text-text-muted">
          <summary className="cursor-pointer">What&apos;s the difference?</summary>
          <p className="mt-2">
            Standard pays via x402+USDC on Base; keys live in Fhenix `euint128`. Trustless pays via SUI;
            keys are sealed by 2-of-3 threshold servers on Sui; inference runs inside a Phala TEE with an
            attestation receipt the SDK verifies.
          </p>
        </details>
      </div>
    </section>
  );
}

function MyBrainScreen({ tier, onMigrate }: { tier: ChainTier; onMigrate: () => void }) {
  const [content, setContent] = useState('');
  return (
    <section className="space-y-4">
      <div className="rounded-lg border border-border bg-card p-6">
        <h2 className="text-lg font-semibold">My Brain</h2>
        <Stepper
          steps={[
            { label: 'Encrypt content', description: 'AES-256-GCM client-side' },
            { label: 'Wrap key', description: tier === 'standard' ? 'FHE euint128' : 'Seal IBE for subscriber identity' },
            { label: 'Upload', description: tier === 'standard' ? 'Supabase chunk store' : 'Walrus blob store' },
            { label: 'Register', description: tier === 'standard' ? 'KnowledgeBaseRegistry on Arbitrum' : 'BrainRegistrySui Move object' },
          ]}
          current={3}
        />
        <Textarea
          className="mt-4"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Drop a .txt/.md/.csv or paste here. Encrypted before it leaves your device."
        />
        <div className="mt-3 flex gap-2">
          <Button tone="success">Upload</Button>
          <Button tone="ghost" onClick={onMigrate}>
            Re-publish on the other tier
          </Button>
        </div>
      </div>
    </section>
  );
}
