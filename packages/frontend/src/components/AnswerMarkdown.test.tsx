import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AnswerMarkdown } from './AnswerMarkdown';

/**
 * AnswerMarkdown — regression coverage for the exact symptoms shown in the
 * /agent/[id]/run RESULT panel bug report (raw <pre> dump of markdown-ish
 * LLM prose): bold asterisks, numbered lists, and "---" dividers all
 * rendered as literal text instead of formatted elements.
 */
describe('AnswerMarkdown', () => {
  it('renders **bold** markdown as a real <strong> element, not literal asterisks', () => {
    render(<AnswerMarkdown text="This is **important** text." />);
    const strong = screen.getByText('important');
    expect(strong.tagName).toBe('STRONG');
    // The literal markdown syntax must not leak into the rendered text.
    expect(screen.queryByText(/\*\*important\*\*/)).not.toBeInTheDocument();
  });

  it('renders a numbered list as <ol><li> elements', () => {
    const text = '1. First item\n2. Second item\n3. Third item';
    render(<AnswerMarkdown text={text} />);
    const list = screen.getByRole('list');
    expect(list.tagName).toBe('OL');
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('First item');
    expect(items[2]).toHaveTextContent('Third item');
  });

  it('renders a standalone "---" line as an <hr>, not literal dashes', () => {
    const text = 'Before the divider.\n\n---\n\nAfter the divider.';
    const { container } = render(<AnswerMarkdown text={text} />);
    const hr = container.querySelector('hr');
    expect(hr).not.toBeNull();
    expect(screen.queryByText('---')).not.toBeInTheDocument();
  });

  it('renders the exact MCP-definitions fixture from the bug report with proper structure', () => {
    // Verbatim (trimmed) shape of the reported unfriendly-format screenshot.
    const fixture = [
      'MCP stands for "Master Control Program." It\'s a term that can refer to several different concepts depending on the context:',
      '',
      '1. **Computing**: In computing, an MCP can be a high-level software system that manages and controls multiple computer systems or networks.',
      '2. **TRON Legacy**: In the context of the movie "TRON: Legacy" and its predecessor "TRON," MCP refers to the "Master Control Program."',
      '',
      '---',
      '',
      'For a deeper dive into the "Master Control Program" from the TRON series, here\'s a brief overview:',
    ].join('\n');
    const { container } = render(<AnswerMarkdown text={fixture} />);
    expect(container.querySelector('ol')).not.toBeNull();
    expect(container.querySelector('hr')).not.toBeNull();
    expect(container.querySelectorAll('strong').length).toBeGreaterThanOrEqual(2);
  });

  it('does not use dangerouslySetInnerHTML (no raw HTML injection)', () => {
    const { container } = render(
      <AnswerMarkdown text={'<img src=x onerror="window.__pwned = true">'} />,
    );
    // react-markdown escapes raw HTML by default (no rehype-raw plugin) —
    // it must render as literal text, never execute as markup.
    expect((window as any).__pwned).toBeUndefined();
    expect(container.querySelector('img')).toBeNull();
  });
});
