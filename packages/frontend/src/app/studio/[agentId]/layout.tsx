'use client';

/**
 * /studio/[agentId] layout — persistent 5-tab bar.
 *
 * Tabs: Overview / Training / Tasks / Memory / Settings.
 * "Settings" is an external link out to /settings (V7 dropped per plan
 * simplification — link-out avoids a placeholder page).
 *
 * SOLID:
 *   • SRP — visual chrome only. Data fetching is per-page inside children.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AppShell } from '@/components/AppShell';

const TABS: Array<{ slug: string; label: string; external?: boolean }> = [
  { slug: '', label: 'Overview' },
  { slug: 'training', label: 'Training' },
  { slug: 'tasks', label: 'Tasks' },
  { slug: 'memory', label: 'Memory' },
  { slug: '/settings', label: 'Settings', external: true },
];

export default function AgentLayout({
  params,
  children,
}: {
  params: { agentId: string };
  children: React.ReactNode;
}): JSX.Element {
  const pathname = usePathname();
  const base = `/studio/${params.agentId}`;

  return (
    <AppShell>
      <div className="mx-auto max-w-6xl px-4 pt-6 md:px-6">
        <Link
          href="/studio"
          className="mb-2 inline-flex items-center gap-1 text-xs text-on-surface-variant hover:text-primary"
        >
          ← Back to studio
        </Link>

        {/* Tab bar */}
        <nav
          className="sticky top-16 -mx-4 flex gap-1 overflow-x-auto border-b border-outline-variant/40 bg-background/95 px-4 backdrop-blur md:mx-0 md:px-0"
          aria-label="Agent tabs"
        >
          {TABS.map((tab) => {
            const href = tab.external ? tab.slug : tab.slug ? `${base}/${tab.slug}` : base;
            const active = tab.external
              ? false
              : tab.slug === ''
              ? pathname === base
              : pathname.startsWith(`${base}/${tab.slug}`);
            return (
              <Link
                key={tab.label}
                href={href}
                className={`shrink-0 border-b-2 px-4 py-3 text-sm font-medium transition ${
                  active
                    ? 'border-primary text-primary'
                    : 'border-transparent text-on-surface-variant hover:text-on-surface'
                }`}
              >
                {tab.label}
                {tab.external && <span aria-hidden className="ml-1 text-xs">↗</span>}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="mx-auto max-w-6xl px-4 py-6 md:px-6 md:py-8">{children}</div>
    </AppShell>
  );
}
