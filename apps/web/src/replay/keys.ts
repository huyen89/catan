/** Keyboard shortcuts of the replay viewer, kept pure so the focus rules are testable. */

export type ReplayKeyAction =
  'togglePlay' | 'stepForward' | 'stepBack' | 'nextTurn' | 'prevTurn' | 'start' | 'end';

/** What has focus, as far as shortcuts care. */
export type FocusKind = 'text' | 'range' | 'button' | 'other';

export function focusKind(t: EventTarget | null): FocusKind {
  if (typeof HTMLElement === 'undefined' || !(t instanceof HTMLElement)) return 'other';
  if (t.isContentEditable || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return 'text';
  if (t.tagName === 'INPUT') return (t as HTMLInputElement).type === 'range' ? 'range' : 'text';
  if (t.tagName === 'BUTTON') return 'button';
  return 'other';
}

/**
 * The shortcut for a key press, or null to leave the key alone:
 * - text fields and selects keep every key;
 * - a focused button keeps Space (it activates the button), but arrows etc. still work, so
 *   clicking a control does not switch the shortcuts off;
 * - the position slider keeps the arrows, Home and End (native slider keys).
 */
export function replayKeyAction(
  key: string,
  mods: { shift: boolean; ctrl?: boolean; meta?: boolean; alt?: boolean },
  focus: FocusKind,
): ReplayKeyAction | null {
  if (mods.ctrl || mods.meta || mods.alt || focus === 'text') return null;
  if (key === ' ' || key === 'k') return focus === 'button' && key === ' ' ? null : 'togglePlay';
  if (focus === 'range') return null;
  switch (key) {
    case 'ArrowRight':
      return mods.shift ? 'nextTurn' : 'stepForward';
    case 'ArrowLeft':
      return mods.shift ? 'prevTurn' : 'stepBack';
    case 'Home':
      return 'start';
    case 'End':
      return 'end';
    default:
      return null;
  }
}
