/**
 * stripGeneratedFilesStub — parses/removes the server-side artifact-manifest
 * stub appended to `answer` by `extractAndUploadArtifacts()`
 * (packages/api/src/routes/v1Public.ts).
 *
 * The server intentionally keeps emitting this stub in `answer` as a
 * defensive fallback signal for sellers/older responses that don't
 * populate `artifacts[]` (see .nim/nim-skill-memory.md Session 3) — that
 * server behavior is NOT changed here. This helper only controls how the
 * client *displays* the text: strip the literal bracket stub out of the
 * prose passed to the markdown renderer, and hand back the file count
 * separately so the caller can render a small fallback note instead of
 * leaking `[Generated N file(s): …]` as raw text, or duplicating the
 * already-rendered `artifacts[]` download card.
 *
 * Exact server format (must match byte-for-byte):
 *   `\n[Generated ${files.length} file(s):\n${summary}\n]`
 * where `summary` is lines of `  • ${path} (${bytes} bytes)`.
 */

const STUB_RE = /\n?\[Generated (\d+) file\(s\):\n(?:  • .+\n)*\]\s*$/;

export interface StrippedAnswer {
  /** The answer text with the trailing stub (if any) removed and trimmed. */
  prose: string;
  /** File count parsed from the stub, or null if no stub was found. */
  stubFileCount: number | null;
}

export function stripGeneratedFilesStub(answer: string): StrippedAnswer {
  const match = STUB_RE.exec(answer);
  if (!match) {
    return { prose: answer, stubFileCount: null };
  }
  const count = Number.parseInt(match[1], 10);
  if (!Number.isFinite(count)) {
    // Defensive fallback — malformed count should never throw or drop data.
    return { prose: answer, stubFileCount: null };
  }
  const prose = answer.slice(0, match.index).trimEnd();
  return { prose, stubFileCount: count };
}
