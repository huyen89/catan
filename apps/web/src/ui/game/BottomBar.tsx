import {
  COSTS,
  DEV_CARD_TYPES,
  RESOURCES,
  type DevCardType,
  type PlayerView,
  type ResourceCounts,
} from '@hexhaven/engine';
import { canDo, type BuildMode } from '../../game/highlights';
import { DEV_HELP, DEV_LABEL, RESOURCE_LABEL } from '../../game/labels';
import { useGameStore } from '../../store/game';
import { Die, ResourceIcon } from '../icons';

export type DevPicker = 'yearOfPlenty' | 'monopoly' | null;

function Cost({ cost }: { cost: ResourceCounts }) {
  return (
    <span className="cost" aria-hidden="true">
      {RESOURCES.flatMap((r) =>
        Array.from({ length: cost[r] }, (_, i) => (
          <ResourceIcon key={`${r}${i}`} res={r} size={12} />
        )),
      )}
    </span>
  );
}

export function Hand({ view }: { view: PlayerView }) {
  const me = view.viewer !== null ? view.players[view.viewer] : undefined;
  if (!me?.resources) return null;
  const res = me.resources;
  return (
    <section className="hand" aria-label="Your resources">
      {RESOURCES.map((r) => (
        <div key={r} className={res[r] ? 'card' : 'card empty'} title={RESOURCE_LABEL[r]}>
          <ResourceIcon res={r} size={26} />
          <span className="card-label">{RESOURCE_LABEL[r]}</span>
          <span className="card-count" data-testid={`hand-${r}`}>
            {res[r]}
          </span>
        </div>
      ))}
    </section>
  );
}

export function DevCards(props: { view: PlayerView; busy: boolean; onPick(p: DevPicker): void }) {
  const { view, busy } = props;
  const send = useGameStore((s) => s.send);
  const me = view.viewer !== null ? view.players[view.viewer] : undefined;
  if (!me) return null;
  const owned = me.devCards ?? [];
  const fresh = me.newDevCards ?? [];
  const playable = view.legal?.playableDev ?? [];
  const types = DEV_CARD_TYPES.filter((t) => owned.includes(t) || fresh.includes(t));

  const play = (t: DevCardType) => {
    if (t === 'knight') void send({ type: 'PLAY_KNIGHT' });
    else if (t === 'roadBuilding') void send({ type: 'PLAY_ROAD_BUILDING' });
    else if (t === 'yearOfPlenty' || t === 'monopoly') props.onPick(t);
  };

  return (
    <section className="devcards" aria-label="Your development cards">
      {types.length === 0 && <span className="muted small">No development cards</span>}
      {types.map((t) => {
        const n = owned.filter((c) => c === t).length;
        const nNew = fresh.filter((c) => c === t).length;
        const canPlay = t !== 'victoryPoint' && playable.includes(t);
        return (
          <div key={t} className={`dev ${canPlay ? 'playable' : ''}`} title={DEV_HELP[t]}>
            <span className="dev-name">{DEV_LABEL[t]}</span>
            <span className="dev-count">
              {n > 0 && `×${n}`}
              {nNew > 0 && <span className="new-tag">+{nNew} new</span>}
            </span>
            {t !== 'victoryPoint' && (
              <button
                type="button"
                data-testid={`play-dev-${t}`}
                disabled={busy || !canPlay}
                aria-label={`Play ${DEV_LABEL[t]}`}
                onClick={() => play(t)}
              >
                Play
              </button>
            )}
          </div>
        );
      })}
    </section>
  );
}

const BUILDS: Array<{ mode: BuildMode; testId: string; label: string; cost: ResourceCounts }> = [
  { mode: 'buildRoad', testId: 'build-road', label: 'Road', cost: COSTS.road },
  {
    mode: 'buildSettlement',
    testId: 'build-settlement',
    label: 'Settlement',
    cost: COSTS.settlement,
  },
  { mode: 'buildCity', testId: 'build-city', label: 'City', cost: COSTS.city },
];

const BUILD_ACTION = {
  buildRoad: 'BUILD_ROAD',
  buildSettlement: 'BUILD_SETTLEMENT',
  buildCity: 'BUILD_CITY',
} as const;
const AFFORD_KEY = { buildRoad: 'road', buildSettlement: 'settlement', buildCity: 'city' } as const;

export function BuildBar({ view, busy }: { view: PlayerView; busy: boolean }) {
  const mode = useGameStore((s) => s.mode);
  const setMode = useGameStore((s) => s.setMode);
  const send = useGameStore((s) => s.send);
  const legal = view.legal;
  if (!legal) return null;
  const canBuy = canDo(view, 'BUY_DEV') && legal.canAfford.devCard;

  return (
    <section className="buildbar" aria-label="Build">
      {BUILDS.map((b) => {
        const enabled = canDo(view, BUILD_ACTION[b.mode]) && legal.canAfford[AFFORD_KEY[b.mode]];
        const on = mode === b.mode;
        return (
          <button
            key={b.mode}
            type="button"
            className={on ? 'build on' : 'build'}
            data-testid={b.testId}
            aria-pressed={on}
            aria-label={
              on ? `Cancel building a ${b.label.toLowerCase()}` : `Build a ${b.label.toLowerCase()}`
            }
            disabled={busy || (!enabled && !on)}
            onClick={() => setMode(on ? null : b.mode)}
          >
            <span>{b.label}</span>
            <Cost cost={b.cost} />
          </button>
        );
      })}
      <button
        type="button"
        className="build"
        data-testid="buy-dev"
        aria-label="Buy a development card"
        disabled={busy || !canBuy}
        onClick={() => send({ type: 'BUY_DEV' })}
      >
        <span>Dev card</span>
        <Cost cost={COSTS.devCard} />
      </button>
    </section>
  );
}

export function TurnControls({ view, busy }: { view: PlayerView; busy: boolean }) {
  const send = useGameStore((s) => s.send);
  const dice = view.turn.dice;
  const special = view.phase.kind === 'specialBuild' && view.phase.seat === view.viewer;
  return (
    <section className="turn-controls" aria-label="Turn">
      <div className="dice" aria-label={dice ? `Last roll ${dice[0] + dice[1]}` : 'Not rolled yet'}>
        {dice ? (
          <>
            <Die value={dice[0]} />
            <Die value={dice[1]} />
          </>
        ) : (
          <span className="muted small">–</span>
        )}
      </div>
      {special ? (
        <button
          type="button"
          className="primary"
          data-testid="pass-special-build"
          disabled={busy || !canDo(view, 'PASS_SPECIAL_BUILD')}
          onClick={() => send({ type: 'PASS_SPECIAL_BUILD' })}
        >
          Pass
        </button>
      ) : (
        <>
          <button
            type="button"
            className="primary"
            data-testid="roll-dice"
            disabled={busy || !canDo(view, 'ROLL')}
            onClick={() => send({ type: 'ROLL' })}
          >
            Roll dice
          </button>
          <button
            type="button"
            data-testid="end-turn"
            disabled={busy || !canDo(view, 'END_TURN')}
            onClick={() => send({ type: 'END_TURN' })}
          >
            End turn
          </button>
        </>
      )}
    </section>
  );
}
