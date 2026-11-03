import { SpeakerIcon } from '../ui/icons';
import { useSoundStore } from './store';

/** Mute / unmute the game's sound effects (persisted per browser). */
export function SoundToggle() {
  const muted = useSoundStore((s) => s.muted);
  const toggle = useSoundStore((s) => s.toggle);
  return (
    <button
      type="button"
      className="ghost icon-btn"
      data-testid="sound-toggle"
      aria-pressed={muted}
      aria-label="Mute sound effects"
      title={muted ? 'Turn sound effects on' : 'Mute sound effects'}
      onClick={toggle}
    >
      <SpeakerIcon muted={muted} />
    </button>
  );
}
