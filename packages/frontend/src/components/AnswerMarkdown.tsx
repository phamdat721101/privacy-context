'use client';

/**
 * AnswerMarkdown — friendly rendering for agent-generated prose.
 *
 * Replaces the raw `<pre>{answer}</pre>` dump previously used on
 * /agent/[id]/run's RESULT panel, which showed markdown syntax
 * (**bold**, numbered lists, "---" dividers) as literal characters
 * instead of formatted text.
 *
 * Security: no `dangerouslySetInnerHTML`, no `rehype-raw` — raw HTML in
 * the source text is escaped and rendered as plain text, never executed
 * as markup. Agent output is untrusted input.
 *
 * Styling: mapped to the existing OpenX dark-theme Tailwind tokens
 * (tailwind.config.ts) via `react-markdown`'s `components` prop —
 * no `@tailwindcss/typography` plugin, no new colors.
 */

import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

const components: Components = {
  h1: ({ children }) => (
    <h1 className="mt-4 mb-2 font-headline text-lg font-bold text-on-surface first:mt-0">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-4 mb-2 font-headline text-base font-bold text-on-surface first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-3 mb-1.5 font-headline text-sm font-semibold text-on-surface first:mt-0">
      {children}
    </h3>
  ),
  p: ({ children }) => (
    <p className="text-sm leading-relaxed text-on-surface [&:not(:first-child)]:mt-3">{children}</p>
  ),
  strong: ({ children }) => <strong className="font-semibold text-on-surface">{children}</strong>,
  em: ({ children }) => <em className="italic text-on-surface">{children}</em>,
  ul: ({ children }) => (
    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-on-surface">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-on-surface">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  hr: () => <hr className="my-4 border-t border-outline-variant/30" />,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary underline hover:opacity-80"
    >
      {children}
    </a>
  ),
  code: ({ className, children }) => {
    // remark-gfm marks fenced code blocks with a `language-*` className;
    // inline `code` spans have none — style each distinctly.
    const isBlock = Boolean(className);
    if (isBlock) {
      return (
        <code className={`block font-mono text-[12px] text-on-surface ${className ?? ''}`}>
          {children}
        </code>
      );
    }
    return (
      <code className="rounded bg-surface-container-low px-1.5 py-0.5 font-mono text-[12px] text-secondary">
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre className="mt-2 overflow-x-auto rounded-lg border border-outline-variant/30 bg-surface-container-low p-3">
      {children}
    </pre>
  ),
  blockquote: ({ children }) => (
    <blockquote className="mt-2 border-l-2 border-primary/40 pl-3 text-sm italic text-on-surface-variant">
      {children}
    </blockquote>
  ),
  table: ({ children }) => (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full border-collapse text-sm text-on-surface">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-outline-variant/30 bg-surface-container-low px-2 py-1 text-left font-mono text-[11px] uppercase tracking-wider text-on-surface-variant">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border border-outline-variant/30 px-2 py-1">{children}</td>
  ),
};

export function AnswerMarkdown({ text }: { text: string }) {
  return (
    <div className="font-sans">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
