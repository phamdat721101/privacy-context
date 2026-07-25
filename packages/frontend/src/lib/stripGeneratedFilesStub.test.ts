import { describe, expect, it } from 'vitest';
import { stripGeneratedFilesStub } from './stripGeneratedFilesStub';

/**
 * stripGeneratedFilesStub — parses/removes the server-side artifact-manifest
 * stub that `extractAndUploadArtifacts()` (packages/api/src/routes/v1Public.ts)
 * appends to `answer` when it strips <artifact> blocks out of raw LLM output:
 *
 *   `\n[Generated ${files.length} file(s):\n${summary}\n]`
 *
 * where summary lines are `  • ${path} (${bytes} bytes)`.
 *
 * The server-side stub itself is intentionally left untouched (defensive
 * fallback per nim-skill Session 3 memory) — this helper only controls how
 * the client *displays* it, so it doesn't leak as literal bracket text
 * through the markdown renderer and duplicate the separate artifacts[] card.
 */
describe('stripGeneratedFilesStub', () => {
  it('returns the answer unchanged and stubFileCount null when no stub is present', () => {
    const answer = 'Xin chào, bạn có khỏe không?';
    const result = stripGeneratedFilesStub(answer);
    expect(result.prose).toBe(answer);
    expect(result.stubFileCount).toBeNull();
  });

  it('strips the exact server-emitted stub format and extracts the file count', () => {
    const prose = 'Here is the translation of the requested document.';
    const stub = '\n[Generated 1 file(s):\n  • mcp_tron.docx (960 bytes)\n]';
    const answer = prose + stub;
    const result = stripGeneratedFilesStub(answer);
    expect(result.prose).toBe(prose);
    expect(result.stubFileCount).toBe(1);
    expect(result.prose).not.toContain('[Generated');
    expect(result.prose).not.toContain('mcp_tron.docx');
  });

  it('handles multiple files in the stub summary and trims trailing whitespace', () => {
    const prose = 'Two files were produced.';
    const stub =
      '\n[Generated 2 file(s):\n  • report.pdf (2048 bytes)\n  • data.csv (512 bytes)\n]';
    const result = stripGeneratedFilesStub(prose + stub + '\n\n  ');
    expect(result.prose).toBe(prose);
    expect(result.stubFileCount).toBe(2);
  });

  it('falls back safely to treating malformed/partial stub-like text as prose (no throw, no data loss)', () => {
    const answer = 'This text mentions [Generated file] but is not the real stub format.';
    const result = stripGeneratedFilesStub(answer);
    expect(result.stubFileCount).toBeNull();
    expect(result.prose).toBe(answer);
  });

  it('does not throw on empty string input', () => {
    expect(() => stripGeneratedFilesStub('')).not.toThrow();
    const result = stripGeneratedFilesStub('');
    expect(result.prose).toBe('');
    expect(result.stubFileCount).toBeNull();
  });
});
