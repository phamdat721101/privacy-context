'use client';

/**
 * RenderedAnswer — the friendly, formatted view of an agent run's
 * `result.answer`.
 *
 * Replaces the old raw `<pre>{result.answer}</pre>` dump on
 * /agent/[id]/run's RESULT panel. Splits the raw server text into
 * markdown-renderable prose plus (optionally) the
 * `[Generated N file(s): …]` stub `extractAndUploadArtifacts()`
 * (packages/api/src/routes/v1Public.ts) appends server-side as a
 * defensive fallback signal. Display-only — the caller
 * (`downloadAsMarkdown` / `copyToClipboard` in run/page.tsx) must keep
 * using the raw, unstripped `result.answer` so exported/copied text
 * stays a complete record.
 *
 * `artifactCount` gates the fallback note: when the `artifacts[]` card is
 * already populated, showing the stub note too would duplicate it.
 *
 * Kept in its own file (not co-located in page.tsx) because Next.js's App
 * Router restricts page.tsx to a fixed set of named exports
 * (default/metadata/generateStaticParams/…) — any other export fails the
 * generated route-type check at build time.
 */

import { AnswerMarkdown } from '@/components/AnswerMarkdown';
import { stripGeneratedFilesStub } from '@/lib/stripGeneratedFilesStub';

export function RenderedAnswer({
  answer,
  artifactCount,
}: {
  answer: string;
  artifactCount: number;
}) {
  const { prose, stubFileCount } = stripGeneratedFilesStub(answer);
  const hasArtifactCard = artifactCount > 0;
  return (
    <>
      <AnswerMarkdown text={prose} />
      {stubFileCount != null && !hasArtifactCard && (
        <p className="mt-2 font-mono text-[11px] text-on-surface-variant">
          Mentions {stubFileCount} generated file(s) — not available for direct download from
          this seller.
        </p>
      )}
    </>
  );
}
