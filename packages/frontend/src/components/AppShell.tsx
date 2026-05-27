'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { WalletConnect } from './WalletConnect';
import { NetworkSwitcher } from './NetworkSwitcher';
import { ArkivProofPanel } from './ArkivProofPanel';
import { useRole } from '@/hooks/useRole';

interface NavItem {
  href: string;
  icon: string;
  label: string;
}

const BASE_NAV: NavItem[] = [
  { href: '/', icon: 'home', label: 'Home' },
  { href: '/publish', icon: 'edit_note', label: 'Publish' },
  { href: '/marketplace', icon: 'storefront', label: 'Marketplace' },
  { href: '/memory', icon: 'memory', label: 'Memory' },
];
const PRODUCER_NAV: NavItem = { href: '/studio', icon: 'science', label: 'Studio' };
const TAIL_NAV: NavItem[] = [{ href: '/settings', icon: 'tune', label: 'Settings' }];

function isActive(pathname: string, href: string) {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, authenticated } = usePrivy();
  const addr = user?.wallet?.address;
  const { role } = useRole(authenticated ? addr : undefined);

  const items: NavItem[] = [
    ...BASE_NAV,
    ...(role === 'producer' ? [PRODUCER_NAV] : []),
    ...TAIL_NAV,
  ];

  return (
    <div className="min-h-screen bg-background text-on-surface">
      {/* Sticky top header */}
      <header className="sticky top-0 z-40 border-b border-outline-variant/30 bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 md:px-8">
          <Link href="/" className="flex items-center gap-2">
            <span className="font-headline text-lg font-bold tracking-tight">
              <span className="text-primary">F</span>hedin
            </span>
            <span className="hidden font-mono text-[10px] uppercase tracking-widest text-on-surface-variant md:inline">
              FHE-encrypted agents
            </span>
          </Link>

          <nav className="hidden items-center gap-1 md:flex">
            {items.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition-colors ${
                    active
                      ? 'bg-surface-container-high text-primary'
                      : 'text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface'
                  }`}
                >
                  <span className="material-symbols-outlined text-[18px]">{item.icon}</span>
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="flex items-center gap-2">
            <NetworkSwitcher />
            <WalletConnect />
          </div>
        </div>
      </header>

      {/* Page body — bottom padding leaves room for the mobile nav */}
      <main className="mx-auto max-w-6xl px-4 pb-24 pt-6 md:px-8 md:pb-12">{children}</main>

      {/* Mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-outline-variant/30 bg-background/95 backdrop-blur md:hidden">
        <ul className="mx-auto flex max-w-md items-stretch">
          {items.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <li key={item.href} className="flex-1">
                <Link
                  href={item.href}
                  className={`flex h-16 flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors ${
                    active ? 'text-primary' : 'text-on-surface-variant'
                  }`}
                >
                  <span
                    className="material-symbols-outlined text-[22px]"
                    style={active ? { fontVariationSettings: "'FILL' 1" } : undefined}
                  >
                    {item.icon}
                  </span>
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <ArkivProofPanel />
    </div>
  );
}
