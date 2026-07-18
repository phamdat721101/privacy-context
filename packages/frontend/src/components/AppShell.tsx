'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { WalletConnect } from './WalletConnect';
import { useCredits } from '@/hooks/useCredits';

interface NavItem {
  href: string;
  icon: string;
  label: string;
  /** When true, item is only shown to authenticated users. The route stays
   *  reachable via URL — this gates nav visibility, not route auth. */
  requiresAuth?: boolean;
}

// Single source of truth for global nav. Each entry is a top-level
// destination the user lives inside.
const NAV_ITEMS: NavItem[] = [
  { href: '/', icon: 'home', label: 'Home' },
  { href: '/marketplace', icon: 'storefront', label: 'Marketplace' },
  { href: '/studio', icon: 'science', label: 'Studio' },
  { href: '/docs', icon: 'menu_book', label: 'Docs', requiresAuth: true },
  { href: '/settings', icon: 'tune', label: 'Settings' },
];

function isActive(pathname: string, href: string) {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { authenticated } = usePrivy();
  const credits = useCredits();

  const items = NAV_ITEMS.filter((item) => !item.requiresAuth || authenticated);

  return (
    <div className="flex min-h-screen flex-col bg-background text-on-surface">
      {/* Top header — `relative` on mobile (scrolls away to preserve vertical
          space on small screens), `sticky` on md+ where horizontal real-estate
          is plentiful. `overflow-hidden` on the inner row prevents the account
          pill from pushing the layout past the viewport on narrow phones. */}
      <header className="relative z-40 border-b border-outline-variant/30 bg-background/85 backdrop-blur md:sticky md:top-0">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-2 overflow-hidden px-3 sm:gap-4 sm:px-4 md:px-8">
          <Link href="/" className="flex min-w-0 shrink-0 items-center gap-2">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="shrink-0">
              <path d="M12 3L4 7L12 11L20 7L12 3Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-primary"/>
              <path d="M4 17L12 21L20 17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-primary"/>
              <path d="M4 12L12 16L20 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-primary"/>
            </svg>
            <span className="font-headline text-lg font-bold tracking-tight text-primary-text">
              OpenX
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

          <div className="flex min-w-0 shrink-0 items-center gap-2">
            <WalletConnect
              creditsLabel={authenticated && credits.enabled ? credits.display : undefined}
            />
          </div>
        </div>
      </header>

      {/* Q1/Q3: the account pill (WalletConnect) shows the buyer's credit
          balance inline and links to Studio → Wallet tab, which hosts both
          "Your credit balance" (top-up) and "Your earnings" (withdraw). */}

      {/* Page body — `flex-1` makes main grow so the footer sticks to the
          bottom of the viewport when content is short. Mobile keeps the
          24-unit bottom padding for the fixed bottom-nav clearance; desktop
          uses 6-unit because there's no bottom-nav. */}
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-24 pt-6 md:px-8 md:pb-6">
        {children}
      </main>

      <Footer />

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
    </div>
  );
}

// ─── Footer ───────────────────────────────────────────────────────────────
// PRD-F: design footer per home-page/code.html. Inline sub-component (no
// new file) keeps SRP local to AppShell and honors the file-budget rule.

const FOOTER_LINKS: ReadonlyArray<{ href: string; label: string }> = [
  { href: '#', label: 'Terms' },
  { href: '#', label: 'Privacy' },
  { href: '#', label: 'Github' },
  { href: '#', label: 'Discord' },
];

function Footer() {
  return (
    // `mb-16 md:mb-0` keeps the footer above the fixed mobile bottom-nav
    // (h-16) on small screens; on md+ the bottom-nav is hidden so no margin.
    <footer className="mb-16 border-t border-outline-variant/30 bg-surface-container-low md:mb-0">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-6 md:flex-row md:px-8 md:py-8">
        <span className="font-headline text-xl font-bold text-primary">OpenX</span>
        <div className="flex flex-col items-center gap-0.5 text-center">
          <span className="text-sm text-on-surface">
            The open gateway between you and AI agents.
          </span>
          <span className="text-xs text-on-surface-variant">
            © {new Date().getFullYear()} OpenX. All rights reserved.
          </span>
        </div>
        <nav aria-label="Footer">
          <ul className="flex flex-wrap items-center justify-center gap-4">
            {FOOTER_LINKS.map((l) => (
              <li key={l.label}>
                <a
                  href={l.href}
                  className="text-sm text-on-surface-variant transition-colors hover:text-primary"
                >
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </footer>
  );
}
