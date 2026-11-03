import { memo, useMemo, type KeyboardEvent } from 'react';
import {
  graphFor,
  type Board as BoardData,
  type BoardGraph,
  type Hex,
  type PlayerView,
  type Seat,
} from '@hexhaven/engine';
import {
  HEX_SIZE,
  boardViewBox,
  edgeMidpoint,
  edgePoints,
  hexCenter,
  hexCornerPoints,
  isHotToken,
  pointsAttr,
  portAnchor,
  round,
  shrinkSegment,
  tokenPips,
  vertexPoint,
  viewBoxAttr,
} from '../../game/geometry';
import type { EdgeAction, HexAction, Highlights } from '../../game/highlights';
import { TERRAIN_LABEL } from '../../game/labels';
import { GlyphShape, TERRAIN_GLYPH } from '../icons';

export interface BoardProps {
  view: PlayerView;
  highlights: Highlights;
  colorOf(seat: Seat): string;
  nameOf(seat: Seat): string;
  disabled: boolean;
  onVertex(id: string): void;
  onEdge(id: string): void;
  onHex(id: string, action: HexAction): void;
  /** Pick one of your ships to move (moveShip mode). */
  onShip?(id: string): void;
}

const S = HEX_SIZE;
const SETTLEMENT_PATH = 'M-9,9 L-9,-2 L0,-11 L9,-2 L9,9 Z';
const CITY_PATH = 'M-14,11 V-3 L-7,-11 L0,-3 V-1 H14 V11 Z';
const ROBBER_PATH = 'M-8,14 C-8,4 -6,0 -4,-2 A6.5,6.5 0 1 1 4,-2 C6,0 8,4 8,14 Z';
/** A small sailing boat, upright, centred on the edge midpoint. */
const SHIP_HULL = 'M-13,1 L13,1 L8,8 L-8,8 Z';
const SHIP_SAIL = 'M-1,-1 L-1,-14 L10,-1 Z M-3,-1 L-3,-11 L-10,-1 Z';
/** The pirate: a bigger, dark two-masted ship with a pennant. */
const PIRATE_HULL = 'M-17,2 L17,2 L11,11 L-11,11 Z';
const PIRATE_SAIL = 'M-7,0 L-7,-15 L4,0 Z M5,0 L5,-12 L14,0 Z';
const PIRATE_FLAG = 'M-7,-15 L-7,-21 L0,-18 Z';

const EDGE_VERB: Record<EdgeAction, string> = {
  PLACE_ROAD: 'Place a road',
  BUILD_ROAD: 'Build a road',
  PLACE_SHIP: 'Place a ship',
  BUILD_SHIP: 'Build a ship',
  MOVE_SHIP: 'Move the ship',
};
const SHIP_ACTIONS: ReadonlySet<EdgeAction> = new Set(['PLACE_SHIP', 'BUILD_SHIP', 'MOVE_SHIP']);

function activate(fn: () => void) {
  return (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fn();
    }
  };
}

function HexTile({ h }: { h: Hex }) {
  const c = hexCenter(h.id);
  const glyph = TERRAIN_GLYPH[h.terrain];
  const sea = h.terrain === 'sea';
  return (
    <g>
      <polygon className={`hex hex-${h.terrain}`} points={pointsAttr(hexCornerPoints(h.q, h.r))} />
      {glyph && (
        <g
          transform={`translate(${round(c.x)} ${round(c.y - S * (h.token ? 0.5 : 0))}) scale(${h.token ? 0.85 : sea ? 1.1 : 1.4})`}
          className={sea ? 'hex-glyph sea-glyph' : 'hex-glyph'}
        >
          <GlyphShape glyph={glyph} />
        </g>
      )}
      {h.token !== null && (
        <g transform={`translate(${round(c.x)} ${round(c.y + 4)})`} className="token">
          <circle r={S * 0.3} className="token-disc" />
          <text
            y={-1}
            className={isHotToken(h.token) ? 'token-num hot' : 'token-num'}
            textAnchor="middle"
            dominantBaseline="central"
          >
            {h.token}
          </text>
          {Array.from({ length: tokenPips(h.token) }, (_, i) => (
            <circle
              key={i}
              cx={(i - (tokenPips(h.token!) - 1) / 2) * 3.6}
              cy={11}
              r={1.3}
              className={isHotToken(h.token!) ? 'token-pip hot' : 'token-pip'}
            />
          ))}
        </g>
      )}
    </g>
  );
}

/**
 * Static layers (terrain, tokens) only change when the board does. Sea is drawn under the land
 * so every coast keeps the land's sandy outline, and a heavier shoreline traces the land|sea
 * edges on Open Seas boards.
 */
const Terrain = memo(function Terrain({ board, graph }: { board: BoardData; graph: BoardGraph }) {
  const sea = board.hexes.filter((h) => h.terrain === 'sea');
  const land = board.hexes.filter((h) => h.terrain !== 'sea');
  const shore = sea.length > 0 ? graph.coastEdges : [];
  return (
    <g className="terrain">
      {sea.length > 0 && (
        <g className="sea">
          {sea.map((h) => (
            <HexTile key={h.id} h={h} />
          ))}
        </g>
      )}
      <g className="land">
        {land.map((h) => (
          <HexTile key={h.id} h={h} />
        ))}
      </g>
      {shore.length > 0 && (
        <g className="shore" aria-hidden="true">
          {shore.map((e) => {
            const [a, b] = edgePoints(graph, e);
            return (
              <line
                key={e}
                x1={round(a.x)}
                y1={round(a.y)}
                x2={round(b.x)}
                y2={round(b.y)}
                className="shore-line"
              />
            );
          })}
        </g>
      )}
    </g>
  );
});

const Ports = memo(function Ports({ board, graph }: { board: BoardData; graph: BoardGraph }) {
  return (
    <g className="ports">
      {board.ports.map((p) => {
        const a = portAnchor(graph, p.edge);
        const [v1, v2] = p.vertices.map((v) => vertexPoint(v));
        const label = p.type === 'any' ? '3:1' : '2:1';
        const title =
          p.type === 'any' ? 'Port: 3 of any resource for 1' : `Port: 2 ${p.type} for 1`;
        return (
          <g key={p.edge} className="port">
            <title>{title}</title>
            {[v1!, v2!].map((v, i) => (
              <line
                key={i}
                x1={round(v.x)}
                y1={round(v.y)}
                x2={round(a.x)}
                y2={round(a.y)}
                className="port-dock"
              />
            ))}
            <circle cx={round(a.x)} cy={round(a.y)} r={S * 0.3} className="port-disc" />
            {p.type !== 'any' && (
              <g transform={`translate(${round(a.x)} ${round(a.y - 6)}) scale(0.5)`}>
                <GlyphShape glyph={p.type} color={`var(--res-${p.type})`} />
              </g>
            )}
            <text
              x={round(a.x)}
              y={round(a.y + (p.type === 'any' ? 0 : 9))}
              className="port-label"
              textAnchor="middle"
              dominantBaseline="central"
            >
              {label}
            </text>
          </g>
        );
      })}
    </g>
  );
});

function BoardImpl(props: BoardProps) {
  const { view, highlights: hl, colorOf, nameOf, disabled } = props;
  const board = view.board;
  const vb = useMemo(() => boardViewBox(board), [board]);
  const graph = useMemo(() => graphFor(board), [board]);
  const hexById = useMemo(() => new Map(board.hexes.map((h) => [h.id, h])), [board]);
  const robber = hexCenter(view.robber);
  const pirate = view.pirate ? hexCenter(view.pirate) : null;
  const ships = view.ships ?? {};
  const hexLabel = (id: string) => {
    const h = hexById.get(id);
    return h ? `${TERRAIN_LABEL[h.terrain]}${h.token ? ` ${h.token}` : ''}` : id;
  };
  const hexTargets = [
    ...hl.hexes.map((id) => [id, 'MOVE_ROBBER'] as const),
    ...hl.pirateHexes.map((id) => [id, 'MOVE_PIRATE'] as const),
  ];
  const edgeVerb = hl.edgeAction ? EDGE_VERB[hl.edgeAction] : 'Build a road';
  const seaEdges = hl.edgeAction !== null && SHIP_ACTIONS.has(hl.edgeAction);

  return (
    <svg
      className={disabled ? 'board busy' : 'board'}
      data-testid="board"
      viewBox={viewBoxAttr(vb)}
      preserveAspectRatio="xMidYMid meet"
      role="group"
      aria-label="Game board"
    >
      <defs>
        <linearGradient id="hex-gold-fill" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#fff0a8" />
          <stop offset="45%" stopColor="#e39a12" />
          <stop offset="100%" stopColor="#8a4f00" />
        </linearGradient>
      </defs>
      {/* Ports under the terrain on classic boards (docks reach out over the sea); on Open
          Seas they sit on inner coasts and must stay above the sea hexes. */}
      {graph.seaEdges.length === 0 && <Ports board={board} graph={graph} />}
      <Terrain board={board} graph={graph} />
      {graph.seaEdges.length > 0 && <Ports board={board} graph={graph} />}

      <g className="roads">
        {Object.entries(view.roads).map(([edge, seat]) => {
          const [a, b] = shrinkSegment(...edgePoints(graph, edge), 0.14);
          const xy = { x1: round(a.x), y1: round(a.y), x2: round(b.x), y2: round(b.y) };
          return (
            <g key={edge}>
              <title>{`${nameOf(seat)}'s road`}</title>
              <line {...xy} className="road-outline" />
              <line {...xy} className="road" stroke={colorOf(seat)} />
            </g>
          );
        })}
      </g>

      {Object.keys(ships).length > 0 && (
        <g className="ships">
          {Object.entries(ships).map(([edge, seat]) => {
            const [a, b] = shrinkSegment(...edgePoints(graph, edge), 0.2);
            const m = edgeMidpoint(graph, edge);
            return (
              <g key={edge} data-testid={`ship-${edge}`}>
                <title>{`${nameOf(seat)}'s ship`}</title>
                <line
                  x1={round(a.x)}
                  y1={round(a.y)}
                  x2={round(b.x)}
                  y2={round(b.y)}
                  className="ship-wake"
                  stroke={colorOf(seat)}
                />
                <g transform={`translate(${round(m.x)} ${round(m.y + 2)})`} className="ship">
                  <path d={SHIP_SAIL} className="ship-sail" fill={colorOf(seat)} />
                  <path d={SHIP_HULL} className="ship-hull" fill={colorOf(seat)} />
                </g>
              </g>
            );
          })}
        </g>
      )}

      <g
        className="robber"
        transform={`translate(${round(robber.x - S * 0.5)} ${round(robber.y + 2)})`}
      >
        <title>Robber</title>
        <path d={ROBBER_PATH} />
      </g>

      {pirate && (
        <g
          className="pirate"
          data-testid="pirate"
          transform={`translate(${round(pirate.x)} ${round(pirate.y + 4)})`}
        >
          <title>Pirate</title>
          <path d={PIRATE_SAIL} className="pirate-sail" />
          <path d={PIRATE_FLAG} className="pirate-flag" />
          <path d={PIRATE_HULL} className="pirate-hull" />
        </g>
      )}

      <g className="buildings">
        {Object.entries(view.buildings).map(([v, b]) => {
          const p = vertexPoint(v);
          return (
            <g key={v} transform={`translate(${round(p.x)} ${round(p.y)})`}>
              <title>{`${nameOf(b.owner)}'s ${b.kind}`}</title>
              <path
                d={b.kind === 'city' ? CITY_PATH : SETTLEMENT_PATH}
                className="building"
                fill={colorOf(b.owner)}
              />
            </g>
          );
        })}
      </g>

      {hexTargets.length > 0 && (
        <g className="hl-hexes">
          {hexTargets.map(([id, action]) => {
            const h = hexById.get(id);
            if (!h) return null;
            const c = hexCenter(id);
            const isPirate = action === 'MOVE_PIRATE';
            return (
              <g
                key={id}
                data-testid={`${isPirate ? 'pirate-hex' : 'hex'}-${id}`}
                className={isPirate ? 'hl hl-hex hl-pirate' : 'hl hl-hex'}
                role="button"
                tabIndex={0}
                aria-label={`Move the ${isPirate ? 'pirate' : 'robber'} to ${hexLabel(id)}`}
                aria-disabled={disabled}
                onClick={() => props.onHex(id, action)}
                onKeyDown={activate(() => props.onHex(id, action))}
              >
                <polygon points={pointsAttr(hexCornerPoints(h.q, h.r, S * 0.9))} />
                <circle
                  cx={round(isPirate ? c.x : c.x - S * 0.5)}
                  cy={round(c.y + 6)}
                  r={isPirate ? 11 : 9}
                />
              </g>
            );
          })}
        </g>
      )}

      {hl.ships.length > 0 && props.onShip && (
        <g className="hl-ships">
          {hl.ships.map((id) => {
            const m = edgeMidpoint(graph, id);
            const picked = hl.shipFrom === id;
            return (
              <g
                key={id}
                data-testid={`pick-ship-${id}`}
                className={picked ? 'hl hl-ship picked' : 'hl hl-ship'}
                role="button"
                tabIndex={0}
                aria-pressed={picked}
                aria-label={picked ? `Ship at ${id} (selected)` : `Move the ship at ${id}`}
                aria-disabled={disabled}
                onClick={() => props.onShip?.(id)}
                onKeyDown={activate(() => props.onShip?.(id))}
              >
                <circle cx={round(m.x)} cy={round(m.y - 2)} r={17} className="hl-mark" />
              </g>
            );
          })}
        </g>
      )}

      {hl.edges.length > 0 && (
        <g className={seaEdges ? 'hl-edges sea' : 'hl-edges'}>
          {hl.edges.map((id) => {
            const [a, b] = shrinkSegment(...edgePoints(graph, id), 0.18);
            const xy = { x1: round(a.x), y1: round(a.y), x2: round(b.x), y2: round(b.y) };
            return (
              <g
                key={id}
                data-testid={`edge-${id}`}
                className="hl hl-edge"
                role="button"
                tabIndex={0}
                aria-label={`${edgeVerb} at ${id}`}
                aria-disabled={disabled}
                onClick={() => props.onEdge(id)}
                onKeyDown={activate(() => props.onEdge(id))}
              >
                <line {...xy} className="hl-hit" />
                <line {...xy} className="hl-mark" />
              </g>
            );
          })}
        </g>
      )}

      {hl.vertices.length > 0 && (
        <g className="hl-vertices">
          {hl.vertices.map((id) => {
            const p = vertexPoint(id);
            const what =
              hl.vertexAction === 'BUILD_CITY' ? 'Upgrade to a city' : 'Build a settlement';
            return (
              <g
                key={id}
                data-testid={`vertex-${id}`}
                className="hl hl-vertex"
                role="button"
                tabIndex={0}
                aria-label={`${what} at ${id}`}
                aria-disabled={disabled}
                onClick={() => props.onVertex(id)}
                onKeyDown={activate(() => props.onVertex(id))}
              >
                <circle cx={round(p.x)} cy={round(p.y)} r={15} className="hl-hit" />
                <circle cx={round(p.x)} cy={round(p.y)} r={9} className="hl-mark" />
              </g>
            );
          })}
        </g>
      )}
    </svg>
  );
}

export const Board = memo(BoardImpl);
