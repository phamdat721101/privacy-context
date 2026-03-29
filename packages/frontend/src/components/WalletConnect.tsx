'use client';
import { useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';

export function WalletConnect() {
  const { ready, authenticated, login, logout, user } = usePrivy();
  const [copied, setCopied] = useState(false);

  function copyAddress(addr: string) {
    navigator.clipboard.writeText(addr);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (!ready) {
    return (
      <button disabled className="pixel-btn pixel-btn-ghost" style={{ fontSize: '12px', padding: '6px 12px' }}>
        LOADING...
      </button>
    );
  }

  if (authenticated) {
    const addr = user?.wallet?.address;
    return (
      <div className="flex items-center gap-2">
        <button
          onClick={() => addr && copyAddress(addr)}
          className="pixel-badge"
          title={addr ?? 'Copy address'}
          style={{ color: 'var(--pixel-teal)', fontFamily: 'Courier New, monospace', fontSize: '10px', background: 'none', border: 'none', cursor: addr ? 'pointer' : 'default' }}
        >
          {copied ? 'COPIED!' : (addr ? `${addr.slice(0, 5)}..${addr.slice(-3)}` : 'OK')}
        </button>
        <button onClick={logout} className="pixel-btn pixel-btn-danger" style={{ fontSize: '11px', padding: '4px 10px' }}>
          EXIT
        </button>
      </div>
    );
  }

  return (
    <button onClick={login} className="pixel-btn pixel-btn-primary" style={{ fontSize: '13px' }}>
      CONNECT WALLET
    </button>
  );
}
