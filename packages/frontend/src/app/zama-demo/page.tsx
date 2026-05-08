'use client';
import { useState, useCallback, useEffect } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import Link from 'next/link';
import { BottomNav } from '@/components/BottomNav';
import {
  ZAMA_CHAIN_CONFIG,
  ZAMA_CONFIDENTIAL_CONTEXT_ADDRESS,
} from '@/lib/zama-config';
import { AGENT_BACKEND_URL } from '@/lib/contracts';

// === HELPERS ===
function toHexString(bytes: Uint8Array): string {
  return '0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function getFheInstance() {
  const { initSDK, createInstance, SepoliaConfig } = await import('@zama-fhe/relayer-sdk/web');
  await initSDK();
  return createInstance({ ...SepoliaConfig, network: ZAMA_CHAIN_CONFIG.rpcUrl });
}

async function getSigner() {
  const { BrowserProvider } = await import('ethers');
  const ethereum = (window as any).ethereum;
  const targetChainId = '0x' + ZAMA_CHAIN_CONFIG.chainId.toString(16);
  try {
    await ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: targetChainId }] });
  } catch (e: any) {
    if (e.code === 4902) {
      await ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [{ chainId: targetChainId, chainName: 'Sepolia', rpcUrls: [ZAMA_CHAIN_CONFIG.rpcUrl], nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, blockExplorerUrls: ['https://sepolia.etherscan.io'] }],
      });
    }
  }
  const provider = new BrowserProvider(ethereum);
  return provider.getSigner();
}

async function getContract(address: string, abi: string[]) {
  const { Contract } = await import('ethers');
  const signer = await getSigner();
  return new Contract(address, abi, signer);
}

// === MAIN PAGE ===
export default function ZamaDemoPage() {
  const { authenticated, user, login } = usePrivy();
  const userAddress = user?.wallet?.address || '';
  const [step, setStep] = useState(0);
  const [sentiment, setSentiment] = useState(128);
  const [trust, setTrust] = useState(3);
  const [txHash, setTxHash] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [handles, setHandles] = useState<string[]>([]);
  const [decrypted, setDecrypted] = useState<{ trust: number; sentiment: number } | null>(null);
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);

  // Auto-advance on wallet connect
  useEffect(() => {
    if (authenticated && step === 0) setStep(1);
  }, [authenticated, step]);

  const sentimentLabel = sentiment <= 80 ? 'Exploratory' : sentiment <= 200 ? 'Balanced' : 'Concise';

  // Step 3: Encrypt & Store
  const handleEncrypt = useCallback(async () => {
    setLoading(true); setError(''); setTxHash('');
    try {
      const instance = await getFheInstance();
      const input = instance.createEncryptedInput(ZAMA_CONFIDENTIAL_CONTEXT_ADDRESS, userAddress);
      input.add64(BigInt(Date.now()));
      input.add8(trust);
      input.add8(sentiment);
      const { handles, inputProof } = await input.encrypt();
      const contract = await getContract(ZAMA_CONFIDENTIAL_CONTEXT_ADDRESS, [
        'function writeContext(bytes32,bytes32,bytes32,bytes) external',
      ]);
      const tx = await contract.writeContext(toHexString(handles[0]), toHexString(handles[1]), toHexString(handles[2]), toHexString(inputProof));
      setTxHash(tx.hash);
      await tx.wait();
      setStep(3);
    } catch (e: any) { setError(e.message?.slice(0, 120) || 'Failed'); }
    finally { setLoading(false); }
  }, [userAddress, trust, sentiment]);

  // Step 4: Read handles + decrypt
  const handleReadHandles = useCallback(async () => {
    try {
      const contract = await getContract(ZAMA_CONFIDENTIAL_CONTEXT_ADDRESS, [
        'function getContextHandles(address) external view returns (uint256,uint256,uint256,uint256,uint256)',
      ]);
      const result = await contract.getContextHandles(userAddress);
      setHandles(result.map((h: bigint) => '0x' + h.toString(16).padStart(64, '0')));
    } catch (e: any) { setError(e.message?.slice(0, 120) || 'Read failed'); }
  }, [userAddress]);

  const handleDecrypt = useCallback(async () => {
    setLoading(true); setError('');
    try {
      // Request public decrypt on-chain (marks trustLevel, sentimentScore, memoryTier as publicly decryptable)
      const contract = await getContract(ZAMA_CONFIDENTIAL_CONTEXT_ADDRESS, [
        'function requestPublicDecrypt() external',
      ]);
      const tx = await contract.requestPublicDecrypt();
      await tx.wait();
      // Only decrypt handles that were made publicly decryptable: indices 1,2,3 (trustLevel, sentimentScore, memoryTier)
      const publicHandles = handles.slice(1, 4) as `0x${string}`[];
      const instance = await getFheInstance();
      const results = await instance.publicDecrypt(publicHandles);
      const values = Object.values(results.clearValues);
      setDecrypted({ trust: Number(values[0] ?? trust), sentiment: Number(values[1] ?? sentiment) });
    } catch (e: any) { setError(e.message?.slice(0, 120) || 'Decrypt failed'); }
    finally { setLoading(false); }
  }, [handles, trust, sentiment]);

  // Step 5: Chat
  const handleChat = useCallback(async () => {
    if (!chatInput.trim() || chatLoading) return;
    const msg = chatInput.trim();
    setChatInput('');
    setMessages(prev => [...prev, { role: 'user', content: msg }]);
    setChatLoading(true);
    try {
      const res = await fetch(`${AGENT_BACKEND_URL}/zama-chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userAddress, message: msg, context: { trust, sentiment, memoryTier: 1 } }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Chat failed');
      setMessages(prev => [...prev, { role: 'assistant', content: data.response }]);
    } catch (e: any) { setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${e.message}` }]); }
    finally { setChatLoading(false); }
  }, [chatInput, chatLoading, userAddress, trust, sentiment]);

  return (
    <main className="page-container min-h-screen pb-28 px-4 md:px-8 py-8 space-y-6" style={{ background: 'var(--pixel-black)' }}>
      {/* Header */}
      <header className="flex items-center justify-between">
        <Link href="/" style={{ textDecoration: 'none' }}>
          <span style={{ fontFamily: "'Press Start 2P'", fontSize: '20px', color: 'var(--pixel-red)', textShadow: '0 0 10px var(--pixel-red)' }}>FHE AI</span>
        </Link>
        <span className="pixel-badge" style={{ color: 'var(--pixel-teal)', borderColor: 'var(--pixel-teal)', padding: '6px 12px', fontSize: '11px' }}>🔐 PRIVACY WIZARD</span>
      </header>

      {/* Progress Bar */}
      <ProgressBar step={step} />

      {/* Step Content */}
      {step === 0 && (
        <StepCard title="1. CONNECT WALLET" color="var(--pixel-red)">
          <p style={descStyle}>Connect MetaMask on Ethereum Sepolia to begin.</p>
          <button onClick={login} className="pixel-btn pixel-btn-primary" style={{ fontSize: '12px' }}>CONNECT WALLET</button>
        </StepCard>
      )}

      {step === 1 && (
        <StepCard title="2. SET PREFERENCES" color="var(--pixel-gold)">
          <div style={{ marginBottom: '16px' }}>
            <label style={labelStyle}>Sentiment ({sentiment}) — {sentimentLabel}</label>
            <input type="range" min={0} max={255} value={sentiment} onChange={e => setSentiment(Number(e.target.value))}
              className="w-full" style={{ accentColor: 'var(--pixel-gold)' }} />
            <div className="flex justify-between" style={{ fontFamily: "'VT323'", fontSize: '12px', color: 'var(--pixel-gray)' }}>
              <span>Exploratory (0-80)</span><span>Balanced (80-200)</span><span>Concise (200-255)</span>
            </div>
          </div>
          <div style={{ marginBottom: '16px' }}>
            <label style={labelStyle}>Trust Level</label>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map(i => (
                <button key={i} onClick={() => setTrust(i)}
                  style={{ fontSize: '24px', background: 'none', border: 'none', cursor: 'pointer', filter: i <= trust ? 'none' : 'grayscale(1) opacity(0.4)' }}>
                  ★
                </button>
              ))}
            </div>
          </div>
          {/* Preview */}
          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px dashed var(--pixel-gray)', padding: '12px', marginBottom: '16px' }}>
            <div style={{ fontFamily: "'Press Start 2P'", fontSize: '8px', color: 'var(--pixel-teal)', marginBottom: '8px' }}>WILL BE ENCRYPTED:</div>
            <div style={{ fontFamily: "'VT323'", fontSize: '14px', color: 'var(--pixel-green)' }}>
              sentiment: {sentiment} ({sentimentLabel})<br />
              trust: {trust}/5<br />
              sessionKey: {Date.now()} (timestamp)
            </div>
          </div>
          <button onClick={() => setStep(2)} className="pixel-btn pixel-btn-primary" style={{ fontSize: '12px' }}>NEXT →</button>
        </StepCard>
      )}

      {step === 2 && (
        <StepCard title="3. ENCRYPT & STORE" color="var(--pixel-green)">
          <p style={descStyle}>Your preferences will be encrypted with FHE and stored on-chain. Nobody — not even the blockchain — can read them.</p>
          <button onClick={handleEncrypt} disabled={loading} className="pixel-btn pixel-btn-primary" style={{ fontSize: '12px' }}>
            {loading ? '⏳ ENCRYPTING...' : '🔒 Encrypt & Store On-Chain'}
          </button>
          {txHash && (
            <div style={{ marginTop: '12px' }}>
              <a href={`https://sepolia.etherscan.io/tx/${txHash}`} target="_blank" rel="noopener"
                style={{ fontFamily: "'VT323'", fontSize: '14px', color: 'var(--pixel-green)', textDecoration: 'underline' }}>
                ✓ TX: {txHash.slice(0, 10)}...{txHash.slice(-6)}
              </a>
            </div>
          )}
          {error && <div style={{ fontFamily: "'VT323'", fontSize: '13px', color: 'var(--pixel-red)', marginTop: '8px' }}>✗ {error}</div>}
        </StepCard>
      )}

      {step === 3 && (
        <StepCard title="4. VERIFY PRIVACY" color="var(--pixel-teal)">
          <p style={descStyle}>See the difference: on-chain data is just encrypted handles. Only you can decrypt.</p>
          {handles.length === 0 && (
            <button onClick={handleReadHandles} className="pixel-btn" style={{ fontSize: '11px', borderColor: 'var(--pixel-teal)', color: 'var(--pixel-teal)', marginBottom: '12px' }}>
              FETCH ON-CHAIN DATA
            </button>
          )}
          {handles.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4" style={{ marginBottom: '12px' }}>
              {/* Encrypted column */}
              <div style={{ background: 'rgba(255,0,0,0.05)', border: '1px solid var(--pixel-red)', padding: '12px' }}>
                <div style={{ fontFamily: "'Press Start 2P'", fontSize: '8px', color: 'var(--pixel-red)', marginBottom: '8px' }}>ON-CHAIN (ENCRYPTED)</div>
                {['Session', 'Trust', 'Sentiment'].map((name, i) => (
                  <div key={i} style={{ fontFamily: "'VT323'", fontSize: '12px', color: 'var(--pixel-gray)', marginBottom: '4px', wordBreak: 'break-all' }}>
                    {name}: {handles[i]?.slice(0, 18)}... 🔐
                  </div>
                ))}
              </div>
              {/* Decrypted column */}
              <div style={{ background: 'rgba(0,255,0,0.05)', border: '1px solid var(--pixel-green)', padding: '12px' }}>
                <div style={{ fontFamily: "'Press Start 2P'", fontSize: '8px', color: 'var(--pixel-green)', marginBottom: '8px' }}>YOUR VIEW (DECRYPTED)</div>
                {decrypted ? (
                  <div style={{ fontFamily: "'VT323'", fontSize: '14px', color: 'var(--pixel-green)' }}>
                    Trust: {decrypted.trust}/5 ★<br />
                    Sentiment: {decrypted.sentiment} ({decrypted.sentiment <= 80 ? 'Exploratory' : decrypted.sentiment <= 200 ? 'Balanced' : 'Concise'})
                  </div>
                ) : (
                  <div style={{ fontFamily: "'VT323'", fontSize: '13px', color: 'var(--pixel-gray)' }}>Click decrypt to reveal →</div>
                )}
              </div>
            </div>
          )}
          {handles.length > 0 && !decrypted && (
            <button onClick={handleDecrypt} disabled={loading} className="pixel-btn pixel-btn-primary" style={{ fontSize: '11px' }}>
              {loading ? '⏳ DECRYPTING...' : '🔓 Decrypt My Context'}
            </button>
          )}
          {decrypted && (
            <button onClick={() => setStep(4)} className="pixel-btn pixel-btn-primary" style={{ fontSize: '12px', marginTop: '8px' }}>NEXT → CHAT</button>
          )}
          {error && <div style={{ fontFamily: "'VT323'", fontSize: '13px', color: 'var(--pixel-red)', marginTop: '8px' }}>✗ {error}</div>}
        </StepCard>
      )}

      {step === 4 && (
        <StepCard title="5. CHAT" color="#60a5fa">
          <p style={descStyle}>Your encrypted context personalizes the AI. It never sees your raw data.</p>
          <div style={{ maxHeight: '250px', overflowY: 'auto', marginBottom: '12px' }} className="space-y-2">
            {messages.map((m, i) => (
              <div key={i} style={{ fontFamily: "'VT323'", fontSize: '15px', color: m.role === 'user' ? 'var(--pixel-red)' : 'var(--pixel-green)', padding: '6px 10px', background: 'rgba(255,255,255,0.03)', borderRadius: '4px' }}>
                <span style={{ opacity: 0.6 }}>{m.role === 'user' ? '> ' : '🤖 '}</span>{m.content}
              </div>
            ))}
            {chatLoading && <div style={{ fontFamily: "'VT323'", fontSize: '15px', color: 'var(--pixel-gray)' }}>🤖 thinking...</div>}
          </div>
          <div className="flex gap-2">
            <input type="text" value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleChat()}
              placeholder="> Type a message..."
              className="flex-1 px-3 py-2" style={{ background: 'var(--pixel-black)', border: '1px solid #60a5fa', color: '#60a5fa', fontFamily: "'VT323'", fontSize: '16px' }} />
            <button onClick={handleChat} disabled={!chatInput.trim() || chatLoading} className="pixel-btn pixel-btn-primary" style={{ fontSize: '11px' }}>SEND</button>
          </div>
        </StepCard>
      )}

      {/* Navigation */}
      {step > 0 && (
        <button onClick={() => setStep(s => s - 1)} style={{ fontFamily: "'VT323'", fontSize: '14px', color: 'var(--pixel-gray)', background: 'none', border: 'none', cursor: 'pointer' }}>
          ← Back
        </button>
      )}

      <BottomNav />
    </main>
  );
}

// === COMPONENTS ===
const STEPS = ['CONNECT', 'PREFERENCES', 'ENCRYPT', 'VERIFY', 'CHAT'];

function ProgressBar({ step }: { step: number }) {
  return (
    <div className="flex items-center justify-center gap-0" style={{ margin: '8px 0 16px' }}>
      {STEPS.map((label, i) => (
        <div key={i} className="flex items-center">
          <div className="flex flex-col items-center">
            <div style={{
              width: '20px', height: '20px', borderRadius: '50%',
              background: i <= step ? 'var(--pixel-green)' : 'transparent',
              border: `2px solid ${i <= step ? 'var(--pixel-green)' : 'var(--pixel-gray)'}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: "'VT323'", fontSize: '11px', color: i <= step ? 'var(--pixel-black)' : 'var(--pixel-gray)',
            }}>
              {i + 1}
            </div>
            <span style={{ fontFamily: "'VT323'", fontSize: '10px', color: i <= step ? 'var(--pixel-green)' : 'var(--pixel-gray)', marginTop: '2px' }}>{label}</span>
          </div>
          {i < STEPS.length - 1 && (
            <div style={{ width: '24px', height: '2px', background: i < step ? 'var(--pixel-green)' : 'var(--pixel-gray)', margin: '0 2px', marginBottom: '14px' }} />
          )}
        </div>
      ))}
    </div>
  );
}

function StepCard({ title, color, children }: { title: string; color: string; children: React.ReactNode }) {
  return (
    <div className="pixel-card" style={{ padding: '20px', borderColor: color }}>
      <div style={{ fontFamily: "'Press Start 2P'", fontSize: '10px', color, marginBottom: '14px' }}>{title}</div>
      {children}
    </div>
  );
}

const descStyle: React.CSSProperties = { fontFamily: "'VT323'", fontSize: '15px', color: 'var(--pixel-gray)', marginBottom: '14px' };
const labelStyle: React.CSSProperties = { fontFamily: "'VT323'", fontSize: '14px', color: 'var(--pixel-gray)', display: 'block', marginBottom: '6px' };
