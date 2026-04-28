'use client';
import { useState, useEffect } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { BottomNav } from '@/components/BottomNav';
import { useTokenBalance, useMintTestTokens, useCreateInvoice, usePayInvoice, useCreateSubscription, useCancelSubscription } from '@/hooks/usePayments';
import { PRIVPAY_GATEWAY_ADDRESS } from '@/lib/contracts';

type Tab = 'wallet' | 'invoices' | 'subscriptions';

export default function PaymentsPage() {
  const { authenticated, ready, user } = usePrivy();
  const router = useRouter();
  const userAddress = user?.wallet?.address as `0x${string}` | undefined;
  const [tab, setTab] = useState<Tab>('wallet');

  useEffect(() => { if (ready && !authenticated) router.push('/'); }, [ready, authenticated, router]);
  if (!ready || !authenticated) return null;

  return (
    <main className="page-container min-h-screen pb-28 px-4 md:px-8 py-8 space-y-6" style={{ background: 'var(--pixel-black)' }}>
      <header className="flex items-center justify-between">
        <Link href="/" style={{ textDecoration: 'none' }}>
          <span style={{ fontFamily: "'Press Start 2P'", fontSize: '24px', color: 'var(--pixel-red)', textShadow: '0 0 10px var(--pixel-red)' }}>FHE AI</span>
        </Link>
        <span className="pixel-badge" style={{ color: 'var(--pixel-gold)', borderColor: 'var(--pixel-gold)', padding: '6px 12px', fontSize: '12px' }}>💰 PRIVPAY</span>
      </header>

      <div style={{ fontFamily: "'Press Start 2P'", fontSize: '12px', color: 'var(--pixel-teal)', marginBottom: '16px' }}>PRIVACY PAYMENTS</div>

      {/* Tabs */}
      <div className="flex gap-2">
        {(['wallet', 'invoices', 'subscriptions'] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className="pixel-btn" style={{ fontSize: '11px', background: tab === t ? 'var(--pixel-red)' : 'transparent', color: tab === t ? '#fff' : 'var(--pixel-gray)', border: `1px solid ${tab === t ? 'var(--pixel-red)' : 'var(--pixel-gray)'}` }}>
            {t.toUpperCase()}
          </button>
        ))}
      </div>

      {tab === 'wallet' && <WalletTab userAddress={userAddress} />}
      {tab === 'invoices' && <InvoicesTab userAddress={userAddress} />}
      {tab === 'subscriptions' && <SubscriptionsTab userAddress={userAddress} />}

      <BottomNav />
    </main>
  );
}

function WalletTab({ userAddress }: { userAddress?: `0x${string}` }) {
  const { data: balanceHandle, refetch } = useTokenBalance(userAddress);
  const { mint, loading: minting, error: mintError } = useMintTestTokens();
  const hasBalance = balanceHandle && balanceHandle !== '0x0000000000000000000000000000000000000000000000000000000000000000';

  return (
    <div className="space-y-4">
      <div className="pixel-card" style={{ padding: '16px' }}>
        <div style={{ fontFamily: "'Press Start 2P'", fontSize: '10px', color: 'var(--pixel-red)', marginBottom: '12px' }}>ENCRYPTED BALANCE</div>
        <div style={{ fontFamily: "'VT323'", fontSize: '16px', color: hasBalance ? 'var(--pixel-green)' : 'var(--pixel-gray)' }}>
          {hasBalance ? '🔒 ENCRYPTED (handle exists on-chain)' : 'NO BALANCE — MINT TEST TOKENS'}
        </div>
        <div style={{ fontFamily: "'VT323'", fontSize: '12px', color: 'var(--pixel-gray)', marginTop: '4px', wordBreak: 'break-all' }}>
          Handle: {balanceHandle ? String(balanceHandle).slice(0, 18) + '...' : '—'}
        </div>
      </div>

      <div className="pixel-card" style={{ padding: '16px', borderColor: 'var(--pixel-gold)' }}>
        <div style={{ fontFamily: "'Press Start 2P'", fontSize: '10px', color: 'var(--pixel-gold)', marginBottom: '12px' }}>MINT TEST TOKENS</div>
        <p style={{ fontFamily: "'VT323'", fontSize: '14px', color: 'var(--pixel-gray)', marginBottom: '8px' }}>
          Get 1,000 encrypted test tokens for demo purposes.
        </p>
        {mintError && <div style={{ fontFamily: "'VT323'", fontSize: '13px', color: 'var(--pixel-danger)', marginBottom: '8px' }}>⚠ {mintError}</div>}
        <button onClick={async () => { if (userAddress) { await mint(userAddress, '1000000000'); refetch(); } }}
          disabled={minting || !userAddress} className="pixel-btn pixel-btn-primary" style={{ fontSize: '12px' }}>
          {minting ? 'MINTING...' : 'MINT 1,000 TOKENS'}
        </button>
      </div>

      <div className="pixel-card" style={{ padding: '16px', borderColor: 'var(--pixel-teal)' }}>
        <div style={{ fontFamily: "'Press Start 2P'", fontSize: '10px', color: 'var(--pixel-teal)', marginBottom: '8px' }}>GATEWAY ADDRESS</div>
        <div style={{ fontFamily: "'VT323'", fontSize: '13px', color: 'var(--pixel-gray)', wordBreak: 'break-all' }}>{PRIVPAY_GATEWAY_ADDRESS || 'Not configured'}</div>
      </div>
    </div>
  );
}

function InvoicesTab({ userAddress }: { userAddress?: `0x${string}` }) {
  const { createInvoice, isPending: creating, error: createError } = useCreateInvoice();
  const { payInvoice, isPending: paying, error: payError } = usePayInvoice();
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('100');
  const [invoiceId, setInvoiceId] = useState('');
  const [payId, setPayId] = useState('');
  const [lastTx, setLastTx] = useState('');

  return (
    <div className="space-y-4">
      <div className="pixel-card" style={{ padding: '16px', borderColor: 'var(--pixel-teal)' }}>
        <div style={{ fontFamily: "'Press Start 2P'", fontSize: '10px', color: 'var(--pixel-teal)', marginBottom: '12px' }}>CREATE INVOICE</div>
        <div className="space-y-2">
          <input value={recipient} onChange={e => setRecipient(e.target.value)} placeholder="Recipient address (0x...)"
            style={{ width: '100%', padding: '8px', background: 'var(--pixel-black)', border: '1px solid var(--pixel-gray)', color: 'var(--pixel-teal)', fontFamily: "'VT323'", fontSize: '14px' }} />
          <input value={amount} onChange={e => setAmount(e.target.value)} placeholder="Amount (tokens)"
            style={{ width: '100%', padding: '8px', background: 'var(--pixel-black)', border: '1px solid var(--pixel-gray)', color: 'var(--pixel-teal)', fontFamily: "'VT323'", fontSize: '14px' }} />
        </div>
        {createError && <div style={{ fontFamily: "'VT323'", fontSize: '13px', color: 'var(--pixel-danger)', marginTop: '8px' }}>⚠ {createError}</div>}
        {lastTx && <div style={{ fontFamily: "'VT323'", fontSize: '12px', color: 'var(--pixel-green)', marginTop: '8px' }}>✓ TX: {lastTx.slice(0, 18)}...</div>}
        <button onClick={async () => {
          if (!userAddress || !recipient) return;
          const tx = await createInvoice(userAddress, BigInt(Number(amount) * 1_000_000), recipient as `0x${string}`, 0);
          if (tx) setLastTx(tx);
        }} disabled={creating || !userAddress} className="pixel-btn pixel-btn-primary w-full" style={{ fontSize: '12px', marginTop: '12px' }}>
          {creating ? 'CREATING...' : 'CREATE ENCRYPTED INVOICE'}
        </button>
      </div>

      <div className="pixel-card" style={{ padding: '16px', borderColor: 'var(--pixel-gold)' }}>
        <div style={{ fontFamily: "'Press Start 2P'", fontSize: '10px', color: 'var(--pixel-gold)', marginBottom: '12px' }}>PAY INVOICE</div>
        <input value={payId} onChange={e => setPayId(e.target.value)} placeholder="Invoice ID (0x...)"
          style={{ width: '100%', padding: '8px', background: 'var(--pixel-black)', border: '1px solid var(--pixel-gray)', color: 'var(--pixel-gold)', fontFamily: "'VT323'", fontSize: '14px', marginBottom: '8px' }} />
        <input value={amount} onChange={e => setAmount(e.target.value)} placeholder="Payment amount"
          style={{ width: '100%', padding: '8px', background: 'var(--pixel-black)', border: '1px solid var(--pixel-gray)', color: 'var(--pixel-gold)', fontFamily: "'VT323'", fontSize: '14px' }} />
        {payError && <div style={{ fontFamily: "'VT323'", fontSize: '13px', color: 'var(--pixel-danger)', marginTop: '8px' }}>⚠ {payError}</div>}
        <button onClick={() => userAddress && payId && payInvoice(userAddress, payId as `0x${string}`, BigInt(Number(amount) * 1_000_000))}
          disabled={paying || !userAddress || !payId} className="pixel-btn pixel-btn-primary w-full" style={{ fontSize: '12px', marginTop: '12px' }}>
          {paying ? 'PAYING...' : 'PAY INVOICE (APPROVE + TRANSFER)'}
        </button>
      </div>
    </div>
  );
}

function SubscriptionsTab({ userAddress }: { userAddress?: `0x${string}` }) {
  const { createSub, isPending: creating, error: createError } = useCreateSubscription();
  const { cancelSub, isPending: cancelling, error: cancelError } = useCancelSubscription();
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('10');
  const [interval, setInterval_] = useState('86400');
  const [cancelId, setCancelId] = useState('');

  return (
    <div className="space-y-4">
      <div className="pixel-card" style={{ padding: '16px', borderColor: 'var(--pixel-purple)' }}>
        <div style={{ fontFamily: "'Press Start 2P'", fontSize: '10px', color: 'var(--pixel-purple)', marginBottom: '12px' }}>CREATE SUBSCRIPTION</div>
        <div className="space-y-2">
          <input value={recipient} onChange={e => setRecipient(e.target.value)} placeholder="Recipient address"
            style={{ width: '100%', padding: '8px', background: 'var(--pixel-black)', border: '1px solid var(--pixel-gray)', color: 'var(--pixel-purple)', fontFamily: "'VT323'", fontSize: '14px' }} />
          <input value={amount} onChange={e => setAmount(e.target.value)} placeholder="Amount per charge"
            style={{ width: '100%', padding: '8px', background: 'var(--pixel-black)', border: '1px solid var(--pixel-gray)', color: 'var(--pixel-purple)', fontFamily: "'VT323'", fontSize: '14px' }} />
          <input value={interval} onChange={e => setInterval_(e.target.value)} placeholder="Interval (seconds)"
            style={{ width: '100%', padding: '8px', background: 'var(--pixel-black)', border: '1px solid var(--pixel-gray)', color: 'var(--pixel-purple)', fontFamily: "'VT323'", fontSize: '14px' }} />
        </div>
        {createError && <div style={{ fontFamily: "'VT323'", fontSize: '13px', color: 'var(--pixel-danger)', marginTop: '8px' }}>⚠ {createError}</div>}
        <button onClick={() => userAddress && recipient && createSub(userAddress, BigInt(Number(amount) * 1_000_000), recipient as `0x${string}`, Number(interval))}
          disabled={creating || !userAddress} className="pixel-btn pixel-btn-primary w-full" style={{ fontSize: '12px', marginTop: '12px' }}>
          {creating ? 'CREATING...' : 'CREATE ENCRYPTED SUBSCRIPTION'}
        </button>
      </div>

      <div className="pixel-card" style={{ padding: '16px', borderColor: 'var(--pixel-gray)' }}>
        <div style={{ fontFamily: "'Press Start 2P'", fontSize: '10px', color: 'var(--pixel-gray)', marginBottom: '12px' }}>CANCEL SUBSCRIPTION</div>
        <input value={cancelId} onChange={e => setCancelId(e.target.value)} placeholder="Subscription ID (0x...)"
          style={{ width: '100%', padding: '8px', background: 'var(--pixel-black)', border: '1px solid var(--pixel-gray)', color: 'var(--pixel-gray)', fontFamily: "'VT323'", fontSize: '14px' }} />
        {cancelError && <div style={{ fontFamily: "'VT323'", fontSize: '13px', color: 'var(--pixel-danger)', marginTop: '8px' }}>⚠ {cancelError}</div>}
        <button onClick={() => cancelId && cancelSub(cancelId as `0x${string}`)}
          disabled={cancelling || !cancelId} className="pixel-btn w-full" style={{ fontSize: '12px', marginTop: '12px', border: '1px solid var(--pixel-danger)', color: 'var(--pixel-danger)' }}>
          {cancelling ? 'CANCELLING...' : 'CANCEL SUBSCRIPTION'}
        </button>
      </div>
    </div>
  );
}
