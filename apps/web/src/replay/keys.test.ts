import { describe, expect, it } from 'vitest';
import { focusKind, replayKeyAction } from './keys';

const plain = { shift: false };
const shift = { shift: true };

describe('replayKeyAction', () => {
  it('maps the shortcuts with nothing focused', () => {
    expect(replayKeyAction(' ', plain, 'other')).toBe('togglePlay');
    expect(replayKeyAction('k', plain, 'other')).toBe('togglePlay');
    expect(replayKeyAction('ArrowRight', plain, 'other')).toBe('stepForward');
    expect(replayKeyAction('ArrowLeft', plain, 'other')).toBe('stepBack');
    expect(replayKeyAction('ArrowRight', shift, 'other')).toBe('nextTurn');
    expect(replayKeyAction('ArrowLeft', shift, 'other')).toBe('prevTurn');
    expect(replayKeyAction('Home', plain, 'other')).toBe('start');
    expect(replayKeyAction('End', plain, 'other')).toBe('end');
    expect(replayKeyAction('x', plain, 'other')).toBeNull();
  });

  it('keeps working after a control button was clicked, except Space', () => {
    expect(replayKeyAction('ArrowRight', plain, 'button')).toBe('stepForward');
    expect(replayKeyAction('End', plain, 'button')).toBe('end');
    expect(replayKeyAction('k', plain, 'button')).toBe('togglePlay');
    // Space activates the focused button natively; handling it too would act twice.
    expect(replayKeyAction(' ', plain, 'button')).toBeNull();
  });

  it('leaves navigation keys to the slider and everything to text fields', () => {
    for (const k of ['ArrowRight', 'ArrowLeft', 'Home', 'End'])
      expect(replayKeyAction(k, plain, 'range')).toBeNull();
    expect(replayKeyAction(' ', plain, 'range')).toBe('togglePlay');
    expect(replayKeyAction(' ', plain, 'text')).toBeNull();
    expect(replayKeyAction('ArrowRight', plain, 'text')).toBeNull();
  });

  it('ignores chords with ctrl, meta or alt', () => {
    expect(replayKeyAction('ArrowRight', { shift: false, ctrl: true }, 'other')).toBeNull();
    expect(replayKeyAction('ArrowLeft', { shift: false, meta: true }, 'other')).toBeNull();
    expect(replayKeyAction(' ', { shift: false, alt: true }, 'other')).toBeNull();
  });

  it('classifies a non-element target as other (no DOM in this environment)', () => {
    expect(focusKind(null)).toBe('other');
  });
});
