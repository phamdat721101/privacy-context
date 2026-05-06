'use client';
import { useState, useCallback } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import Link from 'next/link';
import { BottomNav } from '@/components/BottomNav';
import {
  ZAMA_CHAIN_CONFIG,
  ZAMA_CONFIDENTIAL_CONTEXT_ADDRESS,
  ZAMA_PAYMENT_TOKEN_ADDRESS,
  ZAMA_AGENT_BILLING_ADDRESS,
} from '@/lib/zama-config';
import { AGENT_BACKEND_URL } from '@/lib/contracts';

type Tab = 'context' | 'tokens' | 'agents' | 'chat';

// Convert Uint8Array from fhevmjs to hex string for ethers.js
function toHexString(bytes: Uint8Array): string {
  return '0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Shared helper to get fhevmjs instance
async function getFheInstance() {
  const { initSDK, createInstance, SepoliaConfig } = await import('@zama-fhe/relayer-sdk/web');
  await initSDK();
  return createInstance({
    ...SepoliaConfig,
    network: ZAMA_CHAIN_CONFIG.rpcUrl,
  });
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

export default function ZamaDemoPage() {
  const { authenticated, ready, user, login } = usePrivy();
  const userAddress = user?.wallet?.address;
  const [tab, setTab] = useState<Tab>('context');

  return (
    <main className="page-container min-h-screen pb-28 px-4 md:px-8 py-8 space-y-6" style={{ background: 'var(--pixel-black)' }}>
      <header className="flex items-center justify-between">
        <Link href="/" style={{ textDecoration: 'none' }}>
          <span style={{ fontFamily: "'Press Start 2P'", fontSize: '20px', color: 'var(--pixel-red)', textShadow: '0 0 10px var(--pixel-red)' }}>FHE AI</span>
        </Link>
        <span className="pixel-badge" style={{ color: 'var(--pixel-teal)', borderColor: 'var(--pixel-teal)', padding: '6px 12px', fontSize: '11px' }}>🔐 ZAMA fhEVM Demo</span>
      </header>

      <div style={{ fontFamily: "'Press Start 2P'", fontSize: '11px', color: 'var(--pixel-gold)' }}>CONFIDENTIAL AI CONTEXT</div>
      <p style={{ fontFamily: "'VT323'", fontSize: '15px', color: 'var(--pixel-gray)', marginTop: '4px' }}>
        Privacy-preserving AI agent context management powered by Fully Homomorphic Encryption.
        All data stays encrypted on-chain — only authorized agents can decrypt.
      </p>

      {!authenticated ? (
        <div className="pixel-card" style={{ padding: '16px', borderColor: 'var(--pixel-red)' }}>
          <div style={{ fontFamily: "'Press Start 2P'", fontSize: '10px', color: 'var(--pixel-red)', marginBottom: '12px' }}>CONNECT WALLET</div>
          <p style={{ fontFamily: "'VT323'", fontSize: '14px', color: 'var(--pixel-gray)', marginBottom: '12px' }}>
            Connect MetaMask on Ethereum Sepolia to interact with encrypted AI context.
          </p>
          <button onClick={login} className="pixel-btn pixel-btn-primary" style={{ fontSize: '12px' }}>CONNECT WALLET</button>
        </div>
      ) : (
        <>
          <div className="pixel-card" style={{ padding: '12px' }}>
            <div style={{ fontFamily: "'VT323'", fontSize: '14px', color: 'var(--pixel-green)' }}>
              ✓ {userAddress?.slice(0, 6)}...{userAddress?.slice(-4)} | Sepolia ({ZAMA_CHAIN_CONFIG.chainId})
            </div>
          </div>

          <div className="flex gap-2 flex-wrap">
            {([['context', '📝 CONTEXT'], ['tokens', '🪙 TOKENS'], ['agents', '🤖 AGENTS'], ['chat', '💬 CHAT']] as [Tab, string][]).map(([t, label]) => (
              <button key={t} onClick={() => setTab(t)}
                className="pixel-btn" style={{ fontSize: '10px', background: tab === t ? 'var(--pixel-red)' : 'transparent', color: tab === t ? '#fff' : 'var(--pixel-gray)', border: `1px solid ${tab === t ? 'var(--pixel-red)' : 'var(--pixel-gray)'}` }}>
                {label}
              </button>
            ))}
          </div>

          {tab === 'context' && <ContextSection userAddress={userAddress!} />}
          {tab === 'tokens' && <TokenSection userAddress={userAddress!} />}
          {tab === 'agents' && <AgentSection userAddress={userAddress!} />}
          {tab === 'chat' && <ChatSection userAddress={userAddress!} />}

          <ContractInfo />
        </>
      )}
      <BottomNav />
    </main>
  );
}

// === STATUS DISPLAY ===
function TxStatus({ txHash, error, label }: { txHash: string; error: string; label?: string }) {
  if (!txHash && !error) return null;
  return (
    <div style={{ marginTop: '8px' }}>
      {txHash && (
        <a href={`https://sepolia.etherscan.io/tx/${txHash}`} target="_blank" rel="noopener"
          style={{ fontFamily: "'VT323'", fontSize: '13px', color: 'var(--pixel-green)', textDecoration: 'underline' }}>
          ✓ {label || 'TX'}: {txHash.slice(0, 10)}...{txHash.slice(-6)}
        </a>
      )}
      {error && <div style={{ fontFamily: "'VT323'", fontSize: '13px', color: 'var(--pixel-red)' }}>✗ {error}</div>}
    </div>
  );
}

// === CONTEXT SECTION ===
function ContextSection({ userAddress }: { userAddress: string }) {
  const [sentiment, setSentiment] = useState('75');
  const [trust, setTrust] = useState('3');
  const [agentAddr, setAgentAddr] = useState('');
  const [writing, setWriting] = useState(false);
  const [granting, setGranting] = useState(false);
  const [contextHandles, setContextHandles] = useState<string[]>([]);
  const [txHash, setTxHash] = useState('');
  const [grantTx, setGrantTx] = useState('');
  const [error, setError] = useState('');

  const handleWriteContext = useCallback(async () => {
    setWriting(true); setError(''); setTxHash('');
    try {
      const instance = await getFheInstance();
      const input = instance.createEncryptedInput(ZAMA_CONFIDENTIAL_CONTEXT_ADDRESS, userAddress);
      input.add64(BigInt(Date.now()));
      input.add8(Number(trust));
      input.add8(Number(sentiment));
      const { handles, inputProof } = await input.encrypt();

      const contract = await getContract(ZAMA_CONFIDENTIAL_CONTEXT_ADDRESS, [
        'function writeContext(bytes32,bytes32,bytes32,bytes) external',
      ]);
      const tx = await contract.writeContext(
        toHexString(handles[0]),
        toHexString(handles[1]),
        toHexString(handles[2]),
        toHexString(inputProof),
      );
      setTxHash(tx.hash);
      await tx.wait();
    } catch (e: any) { setError(e.message?.slice(0, 120) || 'Failed'); }
    finally { setWriting(false); }
  }, [userAddress, trust, sentiment]);

  const handleReadContext = useCallback(async () => {
    try {
      const contract = await getContract(ZAMA_CONFIDENTIAL_CONTEXT_ADDRESS, [
        'function getContextHandles(address) external view returns (uint256,uint256,uint256,uint256,uint256)',
      ]);
      const result = await contract.getContextHandles(userAddress);
      setContextHandles(result.map((h: bigint) => '0x' + h.toString(16).padStart(64, '0')));
    } catch (e: any) { setError(e.message?.slice(0, 120) || 'Read failed'); }
  }, [userAddress]);

  const handleGrantAccess = useCallback(async () => {
    if (!agentAddr) return;
    setGranting(true); setGrantTx('');
    try {
      const contract = await getContract(ZAMA_CONFIDENTIAL_CONTEXT_ADDRESS, [
        'function grantAgentAccess(address) external',
      ]);
      const tx = await contract.grantAgentAccess(agentAddr);
      setGrantTx(tx.hash);
      await tx.wait();
    } catch (e: any) { setError(e.message?.slice(0, 120) || 'Grant failed'); }
    finally { setGranting(false); }
  }, [agentAddr]);

  return (
    <div className="space-y-4">
      {/* Write */}
      <div className="pixel-card" style={{ padding: '16px', borderColor: 'var(--pixel-gold)' }}>
        <div style={{ fontFamily: "'Press Start 2P'", fontSize: '9px', color: 'var(--pixel-gold)', marginBottom: '10px' }}>🔒 WRITE ENCRYPTED CONTEXT</div>
        <div className="space-y-3">
          <InputField label="Sentiment Score (0-255)" value={sentiment} onChange={setSentiment} />
          <InputField label="Trust Level (1-5)" value={trust} onChange={setTrust} />
          <button onClick={handleWriteContext} disabled={writing} className="pixel-btn pixel-btn-primary" style={{ fontSize: '11px' }}>
            {writing ? '⏳ ENCRYPTING...' : '🔒 ENCRYPT & WRITE ON-CHAIN'}
          </button>
          <TxStatus txHash={txHash} error={error} label="Write" />
        </div>
      </div>

      {/* Read */}
      <div className="pixel-card" style={{ padding: '16px', borderColor: 'var(--pixel-teal)' }}>
        <div style={{ fontFamily: "'Press Start 2P'", fontSize: '9px', color: 'var(--pixel-teal)', marginBottom: '10px' }}>👁 VIEW ENCRYPTED HANDLES</div>
        <button onClick={handleReadContext} className="pixel-btn" style={{ fontSize: '11px', borderColor: 'var(--pixel-teal)', color: 'var(--pixel-teal)', marginBottom: '8px' }}>
          FETCH ON-CHAIN HANDLES
        </button>
        {contextHandles.length > 0 && (
          <div className="space-y-1" style={{ fontFamily: "'VT323'", fontSize: '12px' }}>
            {['Session Key', 'Trust Level', 'Sentiment', 'Memory Tier', 'Is Active'].map((name, i) => (
              <div key={i} style={{ color: 'var(--pixel-green)' }}>
                {name}: <span style={{ color: 'var(--pixel-gray)' }}>{contextHandles[i]?.slice(0, 18)}...{contextHandles[i] === '0x' + '0'.repeat(64) ? ' (empty)' : ' 🔐'}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Grant Access */}
      <div className="pixel-card" style={{ padding: '16px', borderColor: 'var(--pixel-green)' }}>
        <div style={{ fontFamily: "'Press Start 2P'", fontSize: '9px', color: 'var(--pixel-green)', marginBottom: '10px' }}>🤝 GRANT AGENT ACCESS</div>
        <InputField label="Agent Address (0x...)" value={agentAddr} onChange={setAgentAddr} />
        <button onClick={handleGrantAccess} disabled={granting || !agentAddr} className="pixel-btn pixel-btn-primary" style={{ fontSize: '11px', marginTop: '8px' }}>
          {granting ? '⏳ GRANTING...' : '✓ GRANT DECRYPT ACCESS'}
        </button>
        <TxStatus txHash={grantTx} error="" label="Grant" />
      </div>
    </div>
  );
}

// === TOKEN SECTION ===
function TokenSection({ userAddress }: { userAddress: string }) {
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('1000');
  const [transferring, setTransferring] = useState(false);
  const [txHash, setTxHash] = useState('');
  const [error, setError] = useState('');
  const [balanceHandle, setBalanceHandle] = useState('');

  const handleTransfer = useCallback(async () => {
    if (!recipient) return;
    setTransferring(true); setError(''); setTxHash('');
    try {
      const instance = await getFheInstance();
      const input = instance.createEncryptedInput(ZAMA_PAYMENT_TOKEN_ADDRESS, userAddress);
      input.add64(BigInt(amount));
      const { handles, inputProof } = await input.encrypt();

      const contract = await getContract(ZAMA_PAYMENT_TOKEN_ADDRESS, [
        'function encryptedTransfer(address,bytes32,bytes) external',
      ]);
      const tx = await contract.encryptedTransfer(recipient, toHexString(handles[0]), toHexString(inputProof));
      setTxHash(tx.hash);
      await tx.wait();
    } catch (e: any) { setError(e.message?.slice(0, 120) || 'Transfer failed'); }
    finally { setTransferring(false); }
  }, [userAddress, recipient, amount]);

  const handleCheckBalance = useCallback(async () => {
    try {
      const contract = await getContract(ZAMA_PAYMENT_TOKEN_ADDRESS, [
        'function getBalanceHandle(address) external view returns (uint256)',
      ]);
      const handle = await contract.getBalanceHandle(userAddress);
      setBalanceHandle('0x' + handle.toString(16).padStart(64, '0'));
    } catch (e: any) { setError(e.message?.slice(0, 120) || 'Read failed'); }
  }, [userAddress]);

  return (
    <div className="space-y-4">
      {/* Balance */}
      <div className="pixel-card" style={{ padding: '16px', borderColor: 'var(--pixel-teal)' }}>
        <div style={{ fontFamily: "'Press Start 2P'", fontSize: '9px', color: 'var(--pixel-teal)', marginBottom: '10px' }}>🪙 ENCRYPTED BALANCE</div>
        <button onClick={handleCheckBalance} className="pixel-btn" style={{ fontSize: '11px', borderColor: 'var(--pixel-teal)', color: 'var(--pixel-teal)' }}>
          CHECK BALANCE HANDLE
        </button>
        {balanceHandle && (
          <div style={{ fontFamily: "'VT323'", fontSize: '13px', color: 'var(--pixel-green)', marginTop: '8px' }}>
            Handle: {balanceHandle.slice(0, 18)}...{balanceHandle === '0x' + '0'.repeat(64) ? ' (no balance)' : ' 🔐'}
          </div>
        )}
        <p style={{ fontFamily: "'VT323'", fontSize: '12px', color: 'var(--pixel-gray)', marginTop: '6px' }}>
          Balance is encrypted — only you can decrypt it via the Zama gateway.
        </p>
      </div>

      {/* Transfer */}
      <div className="pixel-card" style={{ padding: '16px', borderColor: 'var(--pixel-gold)' }}>
        <div style={{ fontFamily: "'Press Start 2P'", fontSize: '9px', color: 'var(--pixel-gold)', marginBottom: '10px' }}>📤 ENCRYPTED TRANSFER</div>
        <div className="space-y-3">
          <InputField label="Recipient (0x...)" value={recipient} onChange={setRecipient} />
          <InputField label="Amount" value={amount} onChange={setAmount} />
          <button onClick={handleTransfer} disabled={transferring || !recipient} className="pixel-btn pixel-btn-primary" style={{ fontSize: '11px' }}>
            {transferring ? '⏳ ENCRYPTING...' : '📤 SEND (ENCRYPTED)'}
          </button>
          <TxStatus txHash={txHash} error={error} label="Transfer" />
        </div>
      </div>
    </div>
  );
}

// === AGENT SECTION ===
function AgentSection({ userAddress }: { userAddress: string }) {
  const [agentName, setAgentName] = useState('');
  const [price, setPrice] = useState('100');
  const [payAgentId, setPayAgentId] = useState('0');
  const [payAmount, setPayAmount] = useState('100');
  const [registering, setRegistering] = useState(false);
  const [paying, setPaying] = useState(false);
  const [regTx, setRegTx] = useState('');
  const [payTx, setPayTx] = useState('');
  const [error, setError] = useState('');

  const handleRegister = useCallback(async () => {
    if (!agentName) return;
    setRegistering(true); setError(''); setRegTx('');
    try {
      const instance = await getFheInstance();
      const input = instance.createEncryptedInput(ZAMA_AGENT_BILLING_ADDRESS, userAddress);
      input.add64(BigInt(price));
      const { handles, inputProof } = await input.encrypt();

      const contract = await getContract(ZAMA_AGENT_BILLING_ADDRESS, [
        'function registerAgent(string,bytes32,bytes) external returns (uint256)',
      ]);
      const tx = await contract.registerAgent(agentName, toHexString(handles[0]), toHexString(inputProof));
      setRegTx(tx.hash);
      await tx.wait();
    } catch (e: any) { setError(e.message?.slice(0, 120) || 'Register failed'); }
    finally { setRegistering(false); }
  }, [userAddress, agentName, price]);

  const handlePay = useCallback(async () => {
    setPaying(true); setError(''); setPayTx('');
    try {
      const instance = await getFheInstance();

      // Approve billing contract
      const approveInput = instance.createEncryptedInput(ZAMA_PAYMENT_TOKEN_ADDRESS, userAddress);
      approveInput.add64(BigInt(payAmount));
      const approveEnc = await approveInput.encrypt();

      const token = await getContract(ZAMA_PAYMENT_TOKEN_ADDRESS, [
        'function encryptedApprove(address,bytes32,bytes) external',
      ]);
      const approveTx = await token.encryptedApprove(ZAMA_AGENT_BILLING_ADDRESS, toHexString(approveEnc.handles[0]), toHexString(approveEnc.inputProof));
      await approveTx.wait();

      // Pay for access
      const payInput = instance.createEncryptedInput(ZAMA_AGENT_BILLING_ADDRESS, userAddress);
      payInput.add64(BigInt(payAmount));
      const payEnc = await payInput.encrypt();

      const billing = await getContract(ZAMA_AGENT_BILLING_ADDRESS, [
        'function payForAccess(uint256,bytes32,bytes) external',
      ]);
      const tx = await billing.payForAccess(Number(payAgentId), toHexString(payEnc.handles[0]), toHexString(payEnc.inputProof));
      setPayTx(tx.hash);
      await tx.wait();
    } catch (e: any) { setError(e.message?.slice(0, 120) || 'Payment failed'); }
    finally { setPaying(false); }
  }, [userAddress, payAgentId, payAmount]);

  return (
    <div className="space-y-4">
      {/* Register Agent */}
      <div className="pixel-card" style={{ padding: '16px', borderColor: 'var(--pixel-gold)' }}>
        <div style={{ fontFamily: "'Press Start 2P'", fontSize: '9px', color: 'var(--pixel-gold)', marginBottom: '10px' }}>🤖 REGISTER AI AGENT</div>
        <div className="space-y-3">
          <InputField label="Agent Name" value={agentName} onChange={setAgentName} />
          <InputField label="Price (encrypted tokens)" value={price} onChange={setPrice} />
          <button onClick={handleRegister} disabled={registering || !agentName} className="pixel-btn pixel-btn-primary" style={{ fontSize: '11px' }}>
            {registering ? '⏳ REGISTERING...' : '🤖 REGISTER AGENT'}
          </button>
          <TxStatus txHash={regTx} error={error} label="Register" />
        </div>
      </div>

      {/* Pay for Access */}
      <div className="pixel-card" style={{ padding: '16px', borderColor: 'var(--pixel-green)' }}>
        <div style={{ fontFamily: "'Press Start 2P'", fontSize: '9px', color: 'var(--pixel-green)', marginBottom: '10px' }}>💰 PAY FOR CONTEXT ACCESS</div>
        <div className="space-y-3">
          <InputField label="Agent ID" value={payAgentId} onChange={setPayAgentId} />
          <InputField label="Payment Amount" value={payAmount} onChange={setPayAmount} />
          <button onClick={handlePay} disabled={paying} className="pixel-btn pixel-btn-primary" style={{ fontSize: '11px' }}>
            {paying ? '⏳ PROCESSING...' : '💰 APPROVE & PAY (ENCRYPTED)'}
          </button>
          <TxStatus txHash={payTx} error="" label="Payment" />
          {error && !regTx && <div style={{ fontFamily: "'VT323'", fontSize: '13px', color: 'var(--pixel-red)', marginTop: '4px' }}>✗ {error}</div>}
        </div>
      </div>
    </div>
  );
}

// === SHARED COMPONENTS ===
function InputField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label style={{ fontFamily: "'VT323'", fontSize: '14px', color: 'var(--pixel-gray)' }}>{label}</label>
      <input type="text" value={value} onChange={e => onChange(e.target.value)}
        className="w-full mt-1 px-3 py-2" style={{ background: 'var(--pixel-black)', border: '1px solid var(--pixel-gray)', color: 'var(--pixel-green)', fontFamily: "'VT323'", fontSize: '16px' }} />
    </div>
  );
}

// === CHAT SECTION ===
function ChatSection({ userAddress }: { userAddress: string }) {
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSend = useCallback(async () => {
    if (!input.trim() || loading) return;
    const msg = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: msg }]);
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${AGENT_BACKEND_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userAddress, message: msg, serializedPermit: 'zama-demo' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Chat failed');
      setMessages(prev => [...prev, { role: 'assistant', content: data.response }]);
    } catch (e: any) { setError(e.message?.slice(0, 120) || 'Failed'); }
    finally { setLoading(false); }
  }, [input, loading, userAddress]);

  return (
    <div className="space-y-4">
      <div className="pixel-card" style={{ padding: '16px', borderColor: '#60a5fa' }}>
        <div style={{ fontFamily: "'Press Start 2P'", fontSize: '9px', color: '#60a5fa', marginBottom: '10px' }}>💬 CHAT WITH ENCRYPTED CONTEXT</div>
        <p style={{ fontFamily: "'VT323'", fontSize: '13px', color: 'var(--pixel-gray)', marginBottom: '12px' }}>
          Your encrypted trust level & sentiment are used by the AI agent to personalize responses.
          Write your context first (Context tab), then chat here.
        </p>

        {/* Messages */}
        <div style={{ maxHeight: '300px', overflowY: 'auto', marginBottom: '12px' }} className="space-y-2">
          {messages.map((m, i) => (
            <div key={i} style={{ fontFamily: "'VT323'", fontSize: '15px', color: m.role === 'user' ? 'var(--pixel-red)' : 'var(--pixel-green)', padding: '6px 10px', background: 'rgba(255,255,255,0.03)', borderRadius: '4px' }}>
              <span style={{ opacity: 0.6 }}>{m.role === 'user' ? '> ' : '🤖 '}</span>{m.content}
            </div>
          ))}
          {loading && <div style={{ fontFamily: "'VT323'", fontSize: '15px', color: 'var(--pixel-gray)' }}>🤖 thinking...</div>}
        </div>

        {/* Input */}
        <div className="flex gap-2">
          <input type="text" value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSend()}
            placeholder="> Type a message..."
            className="flex-1 px-3 py-2" style={{ background: 'var(--pixel-black)', border: '1px solid #60a5fa', color: '#60a5fa', fontFamily: "'VT323'", fontSize: '16px' }} />
          <button onClick={handleSend} disabled={!input.trim() || loading} className="pixel-btn pixel-btn-primary" style={{ fontSize: '11px' }}>SEND</button>
        </div>
        {error && <div style={{ fontFamily: "'VT323'", fontSize: '13px', color: 'var(--pixel-red)', marginTop: '6px' }}>✗ {error}</div>}
      </div>
    </div>
  );
}

function ContractInfo() {
  return (
    <div className="pixel-card" style={{ padding: '12px', borderColor: 'var(--pixel-gray)', opacity: 0.7 }}>
      <div style={{ fontFamily: "'Press Start 2P'", fontSize: '8px', color: 'var(--pixel-gray)', marginBottom: '8px' }}>DEPLOYED CONTRACTS (SEPOLIA)</div>
      <div className="space-y-1" style={{ fontFamily: "'VT323'", fontSize: '12px', color: 'var(--pixel-gray)', wordBreak: 'break-all' }}>
        <div>🧠 Context: <a href={`https://sepolia.etherscan.io/address/${ZAMA_CONFIDENTIAL_CONTEXT_ADDRESS}`} target="_blank" style={{ color: 'var(--pixel-teal)' }}>{ZAMA_CONFIDENTIAL_CONTEXT_ADDRESS}</a></div>
        <div>🪙 Token: <a href={`https://sepolia.etherscan.io/address/${ZAMA_PAYMENT_TOKEN_ADDRESS}`} target="_blank" style={{ color: 'var(--pixel-teal)' }}>{ZAMA_PAYMENT_TOKEN_ADDRESS}</a></div>
        <div>💼 Billing: <a href={`https://sepolia.etherscan.io/address/${ZAMA_AGENT_BILLING_ADDRESS}`} target="_blank" style={{ color: 'var(--pixel-teal)' }}>{ZAMA_AGENT_BILLING_ADDRESS}</a></div>
      </div>
    </div>
  );
}
