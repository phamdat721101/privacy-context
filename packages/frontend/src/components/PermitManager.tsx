'use client';
import type { PermitState } from '@/types/context';

const AGENT_ADDRESS = (process.env.NEXT_PUBLIC_AGENT_REGISTRY_ADDRESS ?? '0x0') as `0x${string}`;

interface Props {
  permitState: PermitState;
  authorize: (agentAddress: `0x${string}`) => Promise<void>;
  revoke: () => Promise<void>;
  loading: boolean;
  error: string | null;
}

export function PermitManager({ permitState, authorize, revoke, loading, error }: Props) {
  const cardStyle = {
    border: `2px solid ${permitState.serializedPermit ? 'var(--pixel-green)' : 'var(--pixel-gray)'}`,
    boxShadow: `4px 4px 0 ${permitState.serializedPermit ? 'var(--pixel-green)' : 'var(--pixel-gray)'}`,
    background: 'var(--pixel-dark)',
    borderRadius: 0,
    padding: '1rem',
  };

  if (permitState.serializedPermit) {
    const expiresDate = permitState.expiresAt
      ? new Date(permitState.expiresAt * 1000).toLocaleDateString()
      : 'Unknown';
    return (
      <div style={cardStyle} className="space-y-3">
        <div style={{ fontFamily: "'Press Start 2P'", fontSize: '8px', color: 'var(--pixel-green)' }}>
          AGENT AUTHORIZED
        </div>
        <div style={{ fontFamily: "'VT323'", fontSize: '14px', color: 'var(--pixel-gray)' }}>
          🤖 FHE CONTEXT AGENT<br />
          ⏱ EXPIRES: {expiresDate}
        </div>
        {error && (
          <div style={{ fontFamily: "'VT323'", fontSize: '13px', color: 'var(--pixel-danger)' }}>
            ⚠ {error}
          </div>
        )}
        <button onClick={revoke} disabled={loading} className="pixel-btn pixel-btn-danger">
          {loading ? 'REVOKING...' : '🗑 REVOKE ACCESS'}
        </button>
      </div>
    );
  }

  return (
    <div style={cardStyle} className="space-y-3">
      <div style={{ fontFamily: "'VT323'", fontSize: '15px', color: 'var(--pixel-gray)' }}>
        AI AGENT NOT AUTHORIZED TO READ YOUR CONTEXT.
      </div>
      {error && (
        <div style={{ fontFamily: "'VT323'", fontSize: '13px', color: 'var(--pixel-danger)' }}>
          ⚠ {error}
        </div>
      )}
      <button
        onClick={() => authorize(AGENT_ADDRESS)}
        disabled={loading}
        className="pixel-btn pixel-btn-primary"
      >
        {loading ? 'AUTHORIZING...' : 'AUTHORIZE AI AGENT'}
      </button>
    </div>
  );
}
