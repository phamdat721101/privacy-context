'use client';
import type { PermitState } from '@/types/context';
import { AGENT_ADDRESS } from '@/lib/contracts';

interface Props {
  permitState: PermitState;
  authorize: (agentAddress: `0x${string}`) => Promise<void>;
  revoke: () => Promise<void>;
  loading: boolean;
  error: string | null;
}

export function PermitManager({ permitState, authorize, revoke, loading, error }: Props) {
  const cardClass = permitState.serializedPermit ? 'pixel-card-gold' : 'pixel-card-gray';

  if (permitState.serializedPermit) {
    const expiresDate = permitState.expiresAt
      ? new Date(permitState.expiresAt * 1000).toLocaleDateString()
      : 'Unknown';
    return (
      <div className={`${cardClass} space-y-3`}>
        <div className="flex items-center gap-2 mb-4">
           <span style={{ fontFamily: "'Press Start 2P'", fontSize: '10px', color: 'var(--pixel-gray)' }}>[AUTHORIZATION: FHE_AGENT_01]</span>
           <span style={{ fontFamily: "'Press Start 2P'", fontSize: '10px', color: 'var(--pixel-green)', textShadow: '0 0 5px var(--pixel-green)' }}>AGENT AUTHORIZED</span>
        </div>
        <div style={{ fontFamily: "'VT323'", fontSize: '16px', color: 'var(--pixel-gray)' }}>
          🤖 FHE CONTEXT AGENT<br />
          ⏱ EXPIRES: {expiresDate}
        </div>
        {error && (
          <div style={{ fontFamily: "'VT323'", fontSize: '13px', color: 'var(--pixel-danger)' }}>
            ⚠ {error}
          </div>
        )}
        <button onClick={revoke} disabled={loading} className="pixel-btn pixel-btn-danger mt-2">
          {loading ? 'REVOKING...' : 'REVOKE ACCESS'}
        </button>
      </div>
    );
  }

  const isWalletError = Boolean(error && /wallet/i.test(error));

  return (
    <div className={`${cardClass} space-y-3`}>
      <div style={{ fontFamily: "'VT323'", fontSize: '15px', color: 'var(--pixel-gray)' }}>
        AI AGENT NOT AUTHORIZED TO READ YOUR CONTEXT.
      </div>
      {error && (
        <div style={{ fontFamily: "'VT323'", fontSize: '13px', color: 'var(--pixel-danger)' }}>
          {isWalletError
            ? '⚠ WALLET NOT CONNECTED — PLEASE RECONNECT AND TRY AGAIN.'
            : `⚠ ${error}`}
        </div>
      )}
      <button
        onClick={() => authorize(AGENT_ADDRESS)}
        disabled={loading || isWalletError}
        className="pixel-btn pixel-btn-primary"
      >
        {loading ? 'AUTHORIZING...' : (error && !isWalletError) ? 'TRY AGAIN' : 'AUTHORIZE AI AGENT'}
      </button>
    </div>
  );
}
