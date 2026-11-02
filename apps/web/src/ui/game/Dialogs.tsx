import { useState } from 'react';
import { emptyResources, totalResources, type PlayerView, type Resource } from '@hexhaven/engine';
import { RESOURCE_LABEL, plural } from '../../game/labels';
import { discardLimits, discardReady } from '../../game/trade';
import { useGameStore } from '../../store/game';
import { Modal, ResourceChoice, ResourceCounter } from '../common';
import { ResourceIcon } from '../icons';
import type { DevPicker } from './BottomBar';
import { useSeatMeta } from './seats';

export function DiscardDialog({ view, busy }: { view: PlayerView; busy: boolean }) {
  const send = useGameStore((s) => s.send);
  const [sel, setSel] = useState(emptyResources);
  const count = view.legal?.discardCount ?? 0;
  const hand = view.viewer !== null ? view.players[view.viewer]?.resources : undefined;
  if (count <= 0) return null;
  const chosen = totalResources(sel);

  const confirm = async () => {
    if (await send({ type: 'DISCARD', resources: sel })) setSel(emptyResources());
  };

  return (
    <Modal title={`Discard ${plural(count, 'card')}`} testId="discard-dialog">
      <p>
        A 7 was rolled and you hold too many cards. Choose {count} to return to the bank ({chosen}/
        {count} selected).
      </p>
      <ResourceCounter
        label="Discard"
        testPrefix="discard"
        counts={sel}
        onChange={(next) => totalResources(next) <= count && setSel(next)}
        max={discardLimits(sel, count, hand)}
        disabled={busy}
      />
      <div className="actions">
        <button
          type="button"
          className="primary"
          data-testid="discard-confirm"
          disabled={busy || !discardReady(sel, count, hand)}
          onClick={confirm}
        >
          Discard {chosen}/{count}
        </button>
      </div>
    </Modal>
  );
}

export function StealDialog({ view, busy }: { view: PlayerView; busy: boolean }) {
  const send = useGameStore((s) => s.send);
  const { nameOf, colorOf } = useSeatMeta();
  if (view.phase.kind !== 'steal' || view.turn.current !== view.viewer) return null;
  const victims = view.legal?.stealVictims.length ? view.legal.stealVictims : view.phase.candidates;
  return (
    <Modal title="Steal a card" testId="steal-dialog">
      <p>Choose a player to steal one random card from.</p>
      <div className="victims">
        {victims.map((s) => (
          <button
            key={s}
            type="button"
            className="victim"
            data-testid={`steal-victim-${s}`}
            disabled={busy}
            style={{ ['--seat-color' as string]: colorOf(s) }}
            onClick={() => send({ type: 'STEAL', victim: s })}
          >
            <span className="dot" aria-hidden="true" />
            {nameOf(s)}
            <span className="muted">{plural(view.players[s]?.resourceCount ?? 0, 'card')}</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}

export function DevPickerDialog(props: { picker: DevPicker; busy: boolean; onClose(): void }) {
  const send = useGameStore((s) => s.send);
  const [picks, setPicks] = useState<Resource[]>([]);
  const [mono, setMono] = useState<Resource | null>(null);
  if (!props.picker) return null;

  const close = () => {
    setPicks([]);
    setMono(null);
    props.onClose();
  };

  if (props.picker === 'yearOfPlenty') {
    const [a, b] = picks;
    return (
      <Modal title="Year of Plenty" testId="yop-dialog">
        <p>Take any 2 resources from the bank.</p>
        <ResourceChoice
          label="Add resource"
          testPrefix="yop-pick"
          value={null}
          onChange={(r) => setPicks(picks.length >= 2 ? [picks[1]!, r] : [...picks, r])}
        />
        <div className="picked" aria-live="polite">
          {picks.length === 0 && <span className="muted">Nothing chosen yet</span>}
          {picks.map((r, i) => (
            <span key={i} className="count-item">
              <ResourceIcon res={r} size={18} /> {RESOURCE_LABEL[r]}
            </span>
          ))}
        </div>
        <div className="actions">
          <button
            type="button"
            className="primary"
            data-testid="yop-confirm"
            disabled={props.busy || !a || !b}
            onClick={async () => {
              if (a && b && (await send({ type: 'PLAY_YEAR_OF_PLENTY', resources: [a, b] })))
                close();
            }}
          >
            Take resources
          </button>
          <button type="button" className="ghost" onClick={close}>
            Cancel
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Monopoly" testId="monopoly-dialog">
      <p>Every opponent gives you all their cards of one resource.</p>
      <ResourceChoice label="Claim" testPrefix="monopoly-pick" value={mono} onChange={setMono} />
      <div className="actions">
        <button
          type="button"
          className="primary"
          data-testid="monopoly-confirm"
          disabled={props.busy || !mono}
          onClick={async () => {
            if (mono && (await send({ type: 'PLAY_MONOPOLY', resource: mono }))) close();
          }}
        >
          {mono ? `Claim all ${RESOURCE_LABEL[mono]}` : 'Choose a resource'}
        </button>
        <button type="button" className="ghost" onClick={close}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

export function GameOverOverlay(props: { view: PlayerView; onLeave(): void }) {
  const { view } = props;
  const { nameOf, colorOf } = useSeatMeta();
  const [hidden, setHidden] = useState(false);
  if (view.phase.kind !== 'gameOver') return null;
  const winner = view.phase.winner;
  const ranked = [...view.players].sort(
    (a, b) => (b.totalVP ?? b.publicVP) - (a.totalVP ?? a.publicVP),
  );
  if (hidden) {
    return (
      <button type="button" className="show-results" onClick={() => setHidden(false)}>
        Show results
      </button>
    );
  }
  return (
    <div className="modal-backdrop">
      <div className="modal game-over" role="dialog" aria-modal="true" data-testid="game-over">
        <h2>{winner === view.viewer ? 'You win!' : `${nameOf(winner)} wins!`}</h2>
        <ol className="results">
          {ranked.map((p) => (
            <li
              key={p.seat}
              className={p.seat === winner ? 'winner' : ''}
              style={{ ['--seat-color' as string]: colorOf(p.seat) }}
            >
              <span className="dot" aria-hidden="true" />
              <span className="name-text">{nameOf(p.seat)}</span>
              <span className="vp">{p.totalVP ?? p.publicVP} VP</span>
            </li>
          ))}
        </ol>
        <div className="actions">
          <button type="button" className="ghost" onClick={() => setHidden(true)}>
            View board
          </button>
          <button type="button" className="primary" onClick={props.onLeave}>
            Back to home
          </button>
        </div>
      </div>
    </div>
  );
}
