'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/',            icon: '🏠', label: 'HOME' },
  { href: '/chat',        icon: '💬', label: 'CHAT' },
  { href: '/marketplace', icon: '🛒', label: 'SKILLS' },
  { href: '/payments',    icon: '💰', label: 'PAY' },
  { href: '/settings',    icon: '⚙',  label: 'CONFIG' },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 flex justify-center w-full"
      style={{
        background: 'rgba(15, 23, 42, 0.95)',
        backdropFilter: 'blur(10px)',
        borderTop: '1px solid var(--pixel-red)',
        boxShadow: '0 -4px 15px rgba(255, 0, 255, 0.2)',
      }}
    >
      <div className="flex w-full max-w-4xl px-4 md:px-8 h-[72px] md:h-[84px]">
        {TABS.map((tab) => {
          const isActive = pathname === tab.href;
          return (
            <Link
              key={tab.label}
              href={tab.href}
              className="flex flex-col md:flex-row items-center justify-center flex-1 h-full gap-1 md:gap-3 transition-all duration-300"
              style={{
                color: isActive ? 'var(--pixel-red)' : 'var(--pixel-gray)',
                borderTop: isActive ? '3px solid var(--pixel-red)' : '3px solid transparent',
                marginTop: '-1px',
                fontFamily: "'VT323', monospace",
                fontSize: '16px',
                textDecoration: 'none',
                textShadow: isActive ? '0 0 8px var(--pixel-red)' : 'none',
                background: isActive ? 'linear-gradient(180deg, rgba(255,0,255,0.1) 0%, transparent 100%)' : 'transparent',
              }}
            >
              <span className="text-2xl md:text-3xl" style={{ filter: isActive ? 'drop-shadow(0 0 5px var(--pixel-red))' : 'none' }}>
                {tab.icon}
              </span>
              <span className="md:text-xl tracking-widest">{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
