'use client';
import { useState, useEffect } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { BottomNav } from '@/components/BottomNav';
import { useSkillCount, useSaleCount, useListSkill, usePurchaseSkill } from '@/hooks/useSkillMarketplace';
import { useUserLicenses } from '@/hooks/useUserLicenses';
import { SKILLS } from '@/lib/skillDefinitions';

function SkillCard({ index, userAddress, owned }: { index: number; userAddress?: `0x${string}`; owned: boolean }) {
  const { data: salesCount } = useSaleCount(index);
  const { purchaseSkill, isPending: purchasing, error: purchaseError } = usePurchaseSkill();
  const [bought, setBought] = useState(false);
  const meta = SKILLS.find(s => s.publicSkillIndex === index);

  async function handlePurchase() {
    if (!userAddress) return;
    await purchaseSkill(userAddress, index, BigInt((meta?.priceUSDC ?? 50) * 1_000000), 0);
    setBought(true);
  }

  return (
    <div className="pixel-card" style={{ padding: '16px', borderColor: 'var(--pixel-teal)' }}>
      <div style={{ fontFamily: "'Press Start 2P'", fontSize: '10px', color: 'var(--pixel-red)', marginBottom: '8px' }}>
        {meta?.name ?? `SKILL #${index}`}
      </div>
      <div style={{ fontFamily: "'VT323'", fontSize: '16px', color: 'var(--pixel-gray)', marginBottom: '4px' }}>
        {meta?.description ?? '🔒 ENCRYPTED METADATA'}
      </div>
      <div style={{ fontFamily: "'VT323'", fontSize: '14px', color: 'var(--pixel-teal)', marginBottom: '12px' }}>
        PRICE: {meta?.priceUSDC ?? '?'} USDC • LICENSES SOLD: {salesCount !== undefined ? Number(salesCount).toString() : '...'}
      </div>
      {purchaseError && (
        <div style={{ fontFamily: "'VT323'", fontSize: '13px', color: 'var(--pixel-danger)', marginBottom: '8px' }}>
          ⚠ {purchaseError}
        </div>
      )}
      {owned || bought ? (
        <span style={{ fontFamily: "'VT323'", fontSize: '16px', color: 'var(--pixel-green)' }}>✓ OWNED</span>
      ) : (
        <button onClick={handlePurchase} disabled={purchasing || !userAddress}
          className="pixel-btn pixel-btn-primary w-full" style={{ fontSize: '12px' }}>
          {purchasing ? 'PURCHASING...' : 'PURCHASE LICENSE'}
        </button>
      )}
    </div>
  );
}

export default function MarketplacePage() {
  const { authenticated, user, ready } = usePrivy();
  const router = useRouter();
  const userAddress = user?.wallet?.address as `0x${string}` | undefined;
  const { data: totalSkills } = useSkillCount();
  const count = totalSkills !== undefined ? Number(totalSkills) : 0;
  const { hasSkill } = useUserLicenses(userAddress);

  const { listSkill, isPending: listing, error: listError } = useListSkill();
  const [priceInput, setPriceInput] = useState('50');
  const [maxInput, setMaxInput] = useState('100');

  useEffect(() => {
    if (ready && !authenticated) router.push('/');
  }, [ready, authenticated, router]);

  if (!ready || !authenticated) return null;

  async function handleList() {
    if (!userAddress) return;
    await listSkill(userAddress, BigInt(Number(priceInput) * 1_000000), Number(maxInput));
  }

  return (
    <main className="page-container min-h-screen pb-28 px-8 py-8 space-y-6" style={{ background: 'var(--pixel-black)' }}>
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/" style={{ textDecoration: 'none' }}>
            <span style={{ fontFamily: "'Press Start 2P'", fontSize: '24px', color: 'var(--pixel-red)', textShadow: '0 0 10px var(--pixel-red)' }}>
              FHE AI
            </span>
          </Link>
          <span style={{ fontFamily: "'Press Start 2P'", fontSize: '18px', color: 'var(--pixel-gray)' }}>/</span>
          <span style={{ fontFamily: "'Press Start 2P'", fontSize: '18px', color: '#fff' }}>MARKETPLACE</span>
        </div>
        <span className="pixel-badge" style={{ color: 'var(--pixel-teal)', fontSize: '12px' }}>
          {count} SKILLS LISTED
        </span>
      </header>

      {/* List a Skill */}
      <div className="pixel-card-gold" style={{ padding: '16px 20px' }}>
        <div style={{ fontFamily: "'Press Start 2P'", fontSize: '10px', color: 'var(--pixel-gold)', marginBottom: '12px' }}>
          LIST A NEW SKILL
        </div>
        <div className="flex gap-3 items-end flex-wrap">
          <div>
            <label style={{ fontFamily: "'VT323'", fontSize: '14px', color: 'var(--pixel-gray)' }}>PRICE (USDC)</label>
            <input type="number" value={priceInput} onChange={(e) => setPriceInput(e.target.value)}
              style={{ display: 'block', background: 'var(--pixel-black)', border: '1px solid var(--pixel-gold)', color: '#fff', fontFamily: "'VT323'", fontSize: '16px', padding: '6px 10px', width: '100px' }} />
          </div>
          <div>
            <label style={{ fontFamily: "'VT323'", fontSize: '14px', color: 'var(--pixel-gray)' }}>MAX LICENSES</label>
            <input type="number" value={maxInput} onChange={(e) => setMaxInput(e.target.value)}
              style={{ display: 'block', background: 'var(--pixel-black)', border: '1px solid var(--pixel-gold)', color: '#fff', fontFamily: "'VT323'", fontSize: '16px', padding: '6px 10px', width: '100px' }} />
          </div>
          <button onClick={handleList} disabled={listing || !userAddress}
            className="pixel-btn" style={{ background: 'var(--pixel-gold)', color: '#000', fontSize: '12px' }}>
            {listing ? 'LISTING...' : 'LIST SKILL'}
          </button>
        </div>
        {listError && (
          <div style={{ fontFamily: "'VT323'", fontSize: '13px', color: 'var(--pixel-danger)', marginTop: '8px' }}>⚠ {listError}</div>
        )}
      </div>

      {/* Skill Grid */}
      {count === 0 && SKILLS.length === 0 ? (
        <div className="pixel-card flex items-center justify-center" style={{ minHeight: '200px' }}>
          <span style={{ fontFamily: "'VT323'", fontSize: '18px', color: 'var(--pixel-gray)' }}>
            NO SKILLS LISTED YET. BE THE FIRST!
          </span>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {SKILLS.map((s) => (
            <SkillCard key={s.publicSkillIndex} index={s.publicSkillIndex} userAddress={userAddress} owned={hasSkill(s.publicSkillIndex)} />
          ))}
        </div>
      )}

      <BottomNav />
    </main>
  );
}
