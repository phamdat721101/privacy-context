import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RenderedAnswer } from './RenderedAnswer';

/**
 * RenderedAnswer — covers the two conditional-note branches added when
 * wiring AnswerMarkdown + stripGeneratedFilesStub into the /agent/[id]/run
 * RESULT panel:
 *   - artifacts[] populated  -> no duplicate manifest text, no fallback note
 *   - artifacts[] empty + a stub present -> exactly one fallback note, no
 *     raw "[Generated N file(s): …]" bracket text anywhere in the DOM
 */
describe('RenderedAnswer', () => {
  const proseWithStub =
    'Here is the translation of the requested document.\n[Generated 1 file(s):\n  • mcp_tron.docx (960 bytes)\n]';

  it('renders formatted prose with no fallback note when artifacts[] is already populated', () => {
    render(<RenderedAnswer answer={proseWithStub} artifactCount={1} />);
    expect(screen.getByText(/Here is the translation/)).toBeInTheDocument();
    // No duplicate raw manifest text and no fallback note — the existing
    // artifacts[] card (rendered separately by the page) already covers it.
    expect(screen.queryByText(/\[Generated/)).not.toBeInTheDocument();
    expect(screen.queryByText(/mcp_tron\.docx/)).not.toBeInTheDocument();
    expect(screen.queryByText(/not available for direct download/)).not.toBeInTheDocument();
  });

  it('renders exactly one fallback note when artifacts[] is empty and a stub is present', () => {
    render(<RenderedAnswer answer={proseWithStub} artifactCount={0} />);
    expect(screen.getByText(/Here is the translation/)).toBeInTheDocument();
    expect(screen.queryByText(/\[Generated/)).not.toBeInTheDocument();
    const notes = screen.getAllByText(/not available for direct download/);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toHaveTextContent('Mentions 1 generated file(s)');
  });

  it('renders no fallback note when there is no stub at all, regardless of artifact count', () => {
    render(<RenderedAnswer answer="Plain answer, no files." artifactCount={0} />);
    expect(screen.queryByText(/not available for direct download/)).not.toBeInTheDocument();
  });
});
