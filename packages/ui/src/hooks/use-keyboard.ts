import { useEffect } from 'preact/hooks';
import { route } from 'preact-router';

export interface ShortcutMap {
  [chord: string]: () => void;
}

const CHORD_TIMEOUT_MS = 1000;

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLInputElement) return true;
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLSelectElement) return true;
  if (target.isContentEditable) return true;
  const ce = target.getAttribute('contenteditable');
  if (ce === '' || ce === 'true' || ce === 'plaintext-only') return true;
  return false;
}

export function useKeyboardShortcuts(map: ShortcutMap): void {
  useEffect(() => {
    let lastKey = '';
    let lastTime = 0;

    const handler = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isEditableTarget(e.target)) return;
      if (e.key.length !== 1 && e.key !== '/') return;

      const now = Date.now();
      const chord = lastKey && now - lastTime < CHORD_TIMEOUT_MS ? `${lastKey}${e.key}` : e.key;
      const fn = map[chord];
      if (fn) {
        e.preventDefault();
        fn();
        lastKey = '';
        lastTime = 0;
        return;
      }

      lastKey = e.key;
      lastTime = now;
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [map]);
}

export function defaultShortcuts(): ShortcutMap {
  return {
    gd: () => route('/'),
    gb: () => route('/browse'),
    gs: () => route('/scans'),
    go: () => route('/organize'),
    gu: () => route('/duplicates'),
    gh: () => route('/history'),
    gx: () => route('/cleanup'),
    gq: () => route('/quarantine'),
    gr: () => route('/roles'),
    gt: () => route('/throttle'),
  };
}
