import { useEffect, useRef } from 'react';
import type { GameState } from '@hexhaven/engine';
import { navigate } from '../router';
import { useGameStore } from '../store/game';
import { useRoomStore } from '../store/room';
import { GameScreen } from '../ui/game/GameScreen';
import { DEV_NAMES, createDevGame, devApply, devPayload, devRoom } from './devGame';

interface Props {
  players: number;
  seed: string;
  demo: boolean;
  seat: number;
}

/** /dev/board — the game screen driven by a local engine game (no server). */
export function DevBoard({ players, seed, demo, seat }: Props) {
  const stateRef = useRef<{ id: string; state: GameState } | null>(null);
  const gameId = `dev-${players}-${seed}-${demo ? 'demo' : 'fresh'}`;

  useEffect(() => {
    // Keep the local game when only the viewing seat changes (hot-seat play).
    if (stateRef.current?.id !== gameId)
      stateRef.current = { id: gameId, state: createDevGame(players, seed, demo) };
    const state = stateRef.current.state;
    useGameStore.getState().reset();
    useRoomStore.getState().setRoom(devRoom(players));
    useRoomStore.getState().setChat([
      {
        id: 1,
        roomId: 'dev',
        userId: 'dev-1',
        name: DEV_NAMES[1]!,
        text: 'Anyone have ore?',
        ts: 0,
      },
      {
        id: 2,
        roomId: 'dev',
        userId: 'dev-0',
        name: DEV_NAMES[0]!,
        text: 'Maybe for lumber',
        ts: 0,
      },
    ]);
    useGameStore.getState().ingest(devPayload(state, seat, demo, [], gameId));
    useGameStore.getState().setSink(async ({ action }) => {
      const cur = stateRef.current!;
      const res = devApply(cur.state, seat, action);
      if (!res.ok) throw new Error(res.message);
      stateRef.current = { id: cur.id, state: res.state };
      useGameStore.getState().ingest(devPayload(res.state, seat, demo, res.events, gameId));
      return { version: res.state.version };
    });
    return () => {
      useGameStore.getState().setSink(null);
      useGameStore.getState().reset();
      useRoomStore.getState().reset();
    };
  }, [players, seed, demo, seat, gameId]);

  const go = (patch: Partial<Props>) => {
    const p = { players, seed, demo, seat, ...patch };
    const q = new URLSearchParams({
      players: String(p.players),
      seed: p.seed,
      demo: p.demo ? '1' : '0',
      seat: String(Math.min(p.seat, p.players - 1)),
    });
    navigate(`/dev/board?${q.toString()}`, { replace: true });
  };

  return (
    <GameScreen
      chatDisabled
      onLeave={() => navigate('/')}
      header={
        <div className="dev-tools" aria-label="Developer fixture controls">
          <strong>DEV</strong>
          <select
            aria-label="Players"
            value={players}
            onChange={(e) => go({ players: Number(e.target.value) })}
          >
            {[3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                {n}p
              </option>
            ))}
          </select>
          <select
            aria-label="View as seat"
            value={seat}
            onChange={(e) => go({ seat: Number(e.target.value) })}
          >
            {Array.from({ length: players }, (_, i) => (
              <option key={i} value={i}>
                as {DEV_NAMES[i]}
              </option>
            ))}
          </select>
          <label className="small">
            <input
              type="checkbox"
              checked={demo}
              onChange={(e) => go({ demo: e.target.checked })}
            />{' '}
            demo
          </label>
        </div>
      }
    />
  );
}
