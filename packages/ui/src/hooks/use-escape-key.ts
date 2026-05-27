/**
 * Document-level Escape-key handler with sensible guards.
 *
 * Attaches a single `keydown` listener and invokes `onEscape` when the user
 * presses Escape. By default it skips firing while focus is in an editable
 * field (so Esc inside a `<textarea>` doesn't navigate the surrounding UI
 * away) and when a `[role="dialog"]` is open (so we don't double-fire
 * alongside a Radix dialog that already handles Escape itself). The callback
 * is read through a ref, so passing a new function on each render does not
 * detach and reattach the listener.
 */
import * as React from 'react';

export interface UseEscapeKeyOptions {
  /** Skip when focus is in INPUT/TEXTAREA/SELECT/contentEditable. Default true. */
  skipWhileEditing?: boolean;
  /** Skip when an open `[role="dialog"]` exists in the DOM. Default true. */
  skipWhenDialogOpen?: boolean;
}

export function useEscapeKey(
  onEscape: () => void,
  opts: UseEscapeKeyOptions = {},
): void {
  const { skipWhileEditing = true, skipWhenDialogOpen = true } = opts;
  const handlerRef = React.useRef(onEscape);
  React.useEffect(() => {
    handlerRef.current = onEscape;
  }, [onEscape]);

  React.useEffect(() => {
    if (typeof document === 'undefined') return;
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key !== 'Escape') return;
      if (skipWhileEditing) {
        const t = e.target as HTMLElement | null;
        if (t) {
          const tag = t.tagName;
          if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
          if (t.isContentEditable) return;
        }
      }
      if (skipWhenDialogOpen && document.querySelector('[role="dialog"]')) {
        return;
      }
      handlerRef.current();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [skipWhileEditing, skipWhenDialogOpen]);
}
