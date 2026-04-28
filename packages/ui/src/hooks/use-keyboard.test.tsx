import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import { useKeyboardShortcuts, type ShortcutMap } from './use-keyboard.js';

interface ProbeProps {
  map: ShortcutMap;
}

function Probe({ map }: ProbeProps) {
  useKeyboardShortcuts(map);
  return (
    <div>
      <input type="text" data-testid="text-input" />
      <textarea data-testid="textarea" />
      <select data-testid="select">
        <option>x</option>
      </select>
      <div contentEditable data-testid="editable" />
      <input type="search" data-testid="search" />
    </div>
  );
}

afterEach(() => {
  cleanup();
});

function press(key: string, init: KeyboardEventInit = {}): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, ...init }));
}

describe('useKeyboardShortcuts', () => {
  it('fires the chord callback when keys are pressed in sequence', () => {
    const cb = vi.fn();
    render(<Probe map={{ gd: cb }} />);
    press('g');
    press('d');
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('fires single-key shortcuts like /', () => {
    const cb = vi.fn();
    render(<Probe map={{ '/': cb }} />);
    press('/');
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('ignores keydowns when typing in an input element', () => {
    const cb = vi.fn();
    const { getByTestId } = render(<Probe map={{ gd: cb }} />);
    const input = getByTestId('text-input') as HTMLInputElement;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true }));
    expect(cb).not.toHaveBeenCalled();
  });

  it('ignores keydowns from a textarea', () => {
    const cb = vi.fn();
    const { getByTestId } = render(<Probe map={{ gd: cb }} />);
    const ta = getByTestId('textarea') as HTMLTextAreaElement;
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', bubbles: true }));
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true }));
    expect(cb).not.toHaveBeenCalled();
  });

  it('ignores keydowns from a select element', () => {
    const cb = vi.fn();
    const { getByTestId } = render(<Probe map={{ gd: cb }} />);
    const sel = getByTestId('select') as HTMLSelectElement;
    sel.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', bubbles: true }));
    sel.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true }));
    expect(cb).not.toHaveBeenCalled();
  });

  it('ignores keydowns from contenteditable elements', () => {
    const cb = vi.fn();
    const { getByTestId } = render(<Probe map={{ gd: cb }} />);
    const editable = getByTestId('editable') as HTMLElement;
    editable.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', bubbles: true }));
    editable.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true }));
    expect(cb).not.toHaveBeenCalled();
  });

  it('ignores keydowns when ctrl/meta/alt modifier is held (e.g. Ctrl+G browser find)', () => {
    const cb = vi.fn();
    render(<Probe map={{ gd: cb }} />);
    press('g', { ctrlKey: true });
    press('d');
    expect(cb).not.toHaveBeenCalled();
    press('g', { metaKey: true });
    press('d');
    expect(cb).not.toHaveBeenCalled();
    press('g', { altKey: true });
    press('d');
    expect(cb).not.toHaveBeenCalled();
  });

  it('does not chord across a long pause (>1s)', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
      const cb = vi.fn();
      render(<Probe map={{ gd: cb }} />);
      press('g');
      vi.setSystemTime(new Date('2024-01-01T00:00:02Z'));
      press('d');
      expect(cb).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('removes its listener on unmount', () => {
    const cb = vi.fn();
    const { unmount } = render(<Probe map={{ gd: cb }} />);
    unmount();
    press('g');
    press('d');
    expect(cb).not.toHaveBeenCalled();
  });
});
