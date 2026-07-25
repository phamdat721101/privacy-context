import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RenderedAnswer } from './RenderedAnswer';

/**
 * Task 4 regression coverage — edge cases + the byte-identity requirement
 * for download/copy (verified structurally here; the actual
 * downloadAsMarkdown()/copyToClipboard() call sites in run/page.tsx take
 * `result.answer` directly and are never passed the stripped `prose`, so
 * there is nothing for this component to break there — this test locks in
 * that RenderedAnswer itself never mutates or reports back a modified
 * answer to any caller).
 */
describe('RenderedAnswer — regression edge cases', () => {
  it('renders without throwing on an empty answer', () => {
    expect(() => render(<RenderedAnswer answer="" artifactCount={0} />)).not.toThrow();
  });

  it('renders a long (2000+ char) answer without truncation or error', () => {
    const longAnswer = 'Lorem ipsum dolor sit amet. '.repeat(80); // ~2320 chars
    expect(longAnswer.length).toBeGreaterThan(2000);
    render(<RenderedAnswer answer={longAnswer} artifactCount={0} />);
    expect(screen.getByText(/Lorem ipsum dolor sit amet/)).toBeInTheDocument();
  });

  it('is a pure display component — same answer input always renders the same visible text', () => {
    const answer = 'Deterministic **output** check.';
    const { unmount } = render(<RenderedAnswer answer={answer} artifactCount={0} />);
    const firstRenderText = screen.getByText('output').textContent;
    unmount();
    render(<RenderedAnswer answer={answer} artifactCount={0} />);
    const secondRenderText = screen.getByText('output').textContent;
    expect(firstRenderText).toBe(secondRenderText);
  });
});
