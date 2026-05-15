'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/', icon: 'home', label: 'Home' },
  { href: '/chat', icon: 'chat_bubble', label: 'Chat' },
  { href: '/marketplace', icon: 'psychology', label: 'Brains' },
  { href: '/payments', icon: 'workspace_premium', label: 'Subscribe' },
  { href: '/memory', icon: 'memory', label: 'My Brain' },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="glass-nav w-[calc(100%-2rem)] md:w-full max-w-[800px] mb-6 h-[72px] px-2 md:px-6">
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`flex-1 flex flex-col items-center justify-center h-full transition-all duration-200 rounded-lg my-1 ${
              active
                ? 'text-primary border-t-2 border-primary pt-1'
                : 'text-on-surface-variant hover:text-primary hover:bg-surface-bright/10'
            }`}
          >
            <span className="material-symbols-outlined mb-1" style={active ? { fontVariationSettings: "'FILL' 1" } : undefined}>
              {tab.icon}
            </span>
            <span className="font-mono text-[10px] uppercase tracking-wider">{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
