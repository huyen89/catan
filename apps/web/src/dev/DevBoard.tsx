import { useEffect, useRef } from 'react';
import { SCENARIOS, SCENARIO_IDS, type GameState } from '@hexhaven/engine';
import { navigate } from '../router';
import { useGameStore } from '../store/game';
import { useRoomStore } from '../store/room';
import { GameScreen } from '../ui/game/GameScreen';
import { DEV_NAMES, createDevGame, devApply, devPayload, devRoom } from './devGame';
import {
  DEV_SCENES,
  isDevScenario,
  isDevScene,
  type DevScenario,
  type DevScene,
} from './seasFixture';

interface Props {
  players: number;
  seed: string;
  demo: boolean;
  seat: number;
  /** Open Seas scenario id from the URL (ignored unless it is a real scenario). */
  scenario?: string | null;
  scene?: string | null;
}

/** Players clamped to what the Open Seas scenario supports. */
export function devPlayers(players: number, scenario: string | null | undefined): number {
  const id = scenario ?? null;
  if (!isDevScenario(id)) return players;
  const l = SCENARIOS[id];
  return Math.min(l.maxPlayers ?? 6, Math.max(l.minPlayers ?? 3, players));
}

/** /dev/board — the game screen driven by a local engine game (no server). */
export function DevBoard(props: Props) {
  const { seed, demo } = props;
  const rawScenario = props.scenario ?? null;
  const rawScene = props.scene ?? null;
  const scenario: DevScenario | null = isDevScenario(rawScenario) ? rawScenario : null;
  const scene: DevScene | null = scenario && isDevScene(rawScene) ? rawScene : null;
  const players = devPlayers(props.players, scenario);
  const seat = Math.min(props.seat, players - 1);
  const stateRef = useRef<{ id: string; state: GameState } | null>(null);
  const gameId = `dev-${players}-${seed}-${demo ? 'demo' : 'fresh'}-${scenario ?? 'classic'}-${scene ?? 'main'}`;

  useEffect(() => {
    // Keep the local game when only the viewing seat changes (hot-seat play).
    if (stateRef.current?.id !== gameId) {
      const opts = scenario ? { scenario, ...(scene && { scene }) } : {};
      stateRef.current = { id: gameId, state: createDevGame(players, seed, demo, opts) };
    }
    const state = stateRef.current.state;
    useGameStore.getState().reset();
    useRoomStore.getState().setRoom(devRoom(players, scenario ?? undefined));
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
  }, [players, seed, demo, seat, gameId, scenario, scene]);

  const go = (patch: Partial<Props>) => {
    const p = { players, seed, demo, seat, scenario, scene, ...patch };
    const n = devPlayers(p.players, p.scenario);
    const q = new URLSearchParams({
      players: String(n),
      seed: p.seed,
      demo: p.demo ? '1' : '0',
      seat: String(Math.min(p.seat, n - 1)),
    });
    if (p.scenario) q.set('scenario', p.scenario);
    if (p.scenario && p.scene) q.set('scene', p.scene);
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
          <select
            aria-label="Board"
            value={scenario ?? ''}
            onChange={(e) => go({ scenario: e.target.value || null })}
          >
            <option value="">classic</option>
            {SCENARIO_IDS.map((id) => (
              <option key={id} value={id}>
                {SCENARIOS[id].name}
              </option>
            ))}
          </select>
          {scenario && (
            <select
              aria-label="Scene"
              value={scene ?? 'main'}
              onChange={(e) => go({ scene: e.target.value })}
            >
              {DEV_SCENES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          )}
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
