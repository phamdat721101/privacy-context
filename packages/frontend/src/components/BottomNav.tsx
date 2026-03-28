'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/',         icon: '🏠', label: 'HOME' },
  { href: '/chat',     icon: '💬', label: 'CHAT' },
  { href: '/settings', icon: '⚙',  label: 'CONFIG' },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 flex"
      style={{
        background: 'var(--pixel-dark)',
        borderTop: '2px solid var(--pixel-red)',
      }}
    >
      {TABS.map((tab) => {
        const isActive = pathname === tab.href;
        return (
          <Link
            key={tab.label}
            href={tab.href}
            className="flex flex-col items-center justify-center flex-1 py-2 gap-0.5"
            style={{
              color: isActive ? 'var(--pixel-red)' : 'var(--pixel-gray)',
              borderTop: isActive ? '2px solid var(--pixel-red)' : '2px solid transparent',
              marginTop: '-2px',
              fontFamily: "'VT323', monospace",
              fontSize: '10px',
              textDecoration: 'none',
            }}
          >
            <span style={{ fontSize: '18px', lineHeight: 1 }}>{tab.icon}</span>
            <span>{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
