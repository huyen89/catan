import { useEffect, useMemo, useRef } from 'react';
import type { Board } from '@hexhaven/engine';
import { eventSeat, eventText, type EventTextContext } from '../../game/eventText';
import { hexLabel } from '../../game/labels';
import { useGameStore } from '../../store/game';
import { useSeatMeta } from './seats';

export function GameLog({ board }: { board: Board }) {
  const log = useGameStore((s) => s.log);
  const { nameOf, colorOf } = useSeatMeta();
  const ref = useRef<HTMLOListElement>(null);
  const ctx: EventTextContext = useMemo(
    () => ({ name: nameOf, hexLabel: (id) => hexLabel(board, id) }),
    [nameOf, board],
  );

  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log]);

  return (
    <section className="panel log" aria-label="Game log">
      <h2>Log</h2>
      <ol ref={ref} data-testid="game-log" aria-live="polite">
        {log.length === 0 && <li className="muted">Nothing has happened yet.</li>}
        {log.map(({ key, event }) => {
          const seat = eventSeat(event);
          return (
            <li
              key={key}
              className={`log-line ev-${event.type}`}
              style={seat !== null ? { ['--seat-color' as string]: colorOf(seat) } : undefined}
            >
              {seat !== null && <span className="dot" aria-hidden="true" />}
              {eventText(event, ctx)}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
