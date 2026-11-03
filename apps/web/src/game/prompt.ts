import type { PlayerView, Seat } from '@hexhaven/engine';
import type { Highlights, UiMode } from './highlights';
import { plural } from './labels';

export interface Prompt {
  text: string;
  /** 'act' = the viewer has something to do. */
  tone: 'act' | 'wait' | 'done';
}

function listNames(seats: Seat[], name: (s: Seat) => string): string {
  const names = seats.map(name);
  if (names.length <= 1) return names[0] ?? 'others';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** The phase banner: tells the viewer what to do, or who we are waiting for. */
export function phasePrompt(view: PlayerView, name: (s: Seat) => string): Prompt {
  const me = view.viewer;
  const p = view.phase;
  const current = view.turn.current;
  const mine = me !== null && current === me;
  const seas = hasShips(view);
  const wait = (who: Seat, what = ''): Prompt => ({
    text: `Waiting for ${name(who)}${what}…`,
    tone: 'wait',
  });

  switch (p.kind) {
    case 'gameOver':
      return { text: me === p.winner ? 'You win!' : `${name(p.winner)} wins!`, tone: 'done' };
    case 'setup': {
      const who = view.setupOrder[p.index] ?? current;
      if (me !== null && who === me)
        return p.step === 'settlement'
          ? { text: 'Place a settlement', tone: 'act' }
          : {
              text: `Place a ${seas ? 'road or ship' : 'road'} next to your settlement`,
              tone: 'act',
            };
      return wait(
        who,
        p.step === 'settlement'
          ? ' to place a settlement'
          : seas
            ? ' to place a road or ship'
            : ' to place a road',
      );
    }
    case 'preRoll':
      return mine ? { text: 'Roll the dice', tone: 'act' } : wait(current, ' to roll');
    case 'discard': {
      const mineLeft = me !== null ? (p.pending[String(me)] ?? 0) : 0;
      if (mineLeft > 0) return { text: `Discard ${plural(mineLeft, 'card')}`, tone: 'act' };
      const others = Object.entries(p.pending)
        .filter(([, n]) => n > 0)
        .map(([s]) => Number(s));
      return { text: `Waiting for ${listNames(others, name)} to discard…`, tone: 'wait' };
    }
    case 'goldChoice': {
      const mineLeft = me !== null ? (p.pending[String(me)] ?? 0) : 0;
      if (mineLeft > 0)
        return { text: `Choose ${plural(mineLeft, 'resource')} from gold`, tone: 'act' };
      const others = Object.entries(p.pending)
        .filter(([, n]) => n > 0)
        .map(([s]) => Number(s));
      return { text: `Waiting for ${listNames(others, name)} to choose gold…`, tone: 'wait' };
    }
    case 'moveRobber': {
      const what = p.allowPirate ? 'the robber or the pirate' : 'the robber';
      return mine ? { text: `Move ${what}`, tone: 'act' } : wait(current, ` to move ${what}`);
    }
    case 'steal':
      return mine
        ? {
            text:
              p.via === 'pirate' ? 'Choose a ship owner to rob' : 'Choose a player to steal from',
            tone: 'act',
          }
        : wait(current, ' to steal a card');
    case 'roadBuilding':
      return mine
        ? {
            text: `Place ${plural(p.remaining, seas ? 'free road or ship' : 'free road', seas ? 'free roads or ships' : 'free roads')}`,
            tone: 'act',
          }
        : wait(current, seas ? ' to place free roads or ships' : ' to place free roads');
    case 'specialBuild':
      return me === p.seat
        ? { text: 'Special build phase: build or buy, then pass', tone: 'act' }
        : wait(p.seat, ' (special build phase)');
    case 'main': {
      if (mine) return { text: 'Your turn: build, trade or end your turn', tone: 'act' };
      const offerToMe = view.trades.find(
        (t) => me !== null && t.responses[String(me)] === 'pending',
      );
      if (offerToMe) return { text: `${name(offerToMe.from)} offers you a trade`, tone: 'act' };
      return { text: `${name(current)}'s turn`, tone: 'wait' };
    }
  }
}

/** True for variants with ships (Open Seas). */
export const hasShips = (view: Pick<PlayerView, 'config'>): boolean =>
  view.config.variant === 'seafarers';

/** Extra hint under the banner while a multi-step UI mode is active (null when none). */
export function modeHint(mode: UiMode, hl: Pick<Highlights, 'shipFrom'>): string | null {
  switch (mode) {
    case 'moveShip':
      return hl.shipFrom ? 'Choose where the ship sails to' : 'Choose a ship to move';
    case 'buildShip':
      return 'Choose where to build a ship';
    default:
      return null;
  }
}
