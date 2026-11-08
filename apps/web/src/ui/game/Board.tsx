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
  boundsOf,
  clampSprite,
  edgeMidpoint,
  edgePoints,
  hexCenter,
  hexCornerPoints,
  isHotToken,
  landHull,
  pointsAttr,
  portAnchor,
  round,
  shrinkSegment,
  tokenPips,
  vertexPoint,
  viewBoxAttr,
} from '../../game/geometry';
import type { EdgeAction, HexAction, Highlights } from '../../game/highlights';
import { TERRAIN_LABEL, edgePlace } from '../../game/labels';
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
/**
 * Buildings are drawn as little 3D blocks seen from the front-left: a front face in the seat
 * colour, then a darker side wall and a roof slope on top of it (`shade` paths are painted over
 * the colour with translucent black, so any seat colour gets the same lighting).
 */
const SETTLEMENT = {
  body: 'M-8,9 V-1 L0,-9 L5,-13 L13,-5 V5 L8,9 Z',
  side: 'M8,-1 L13,-5 V5 L8,9 Z',
  roof: 'M0,-9 L5,-13 L13,-5 L8,-1 Z',
};
const CITY = {
  body: 'M-12,10 V-3 L-6,-10 L-1,-14 L5,-7 V-4 H15 V6 L10,10 Z',
  side: 'M10,0 L15,-4 V6 L10,10 Z M0,-3 L5,-7 V-4 L0,0 Z',
  roof: 'M-6,-10 L-1,-14 L5,-7 L0,-3 Z M0,0 L5,-4 H15 L10,0 Z',
};

/** Inner fold lines, so the faces read as separate planes. */
const SETTLEMENT_LINES = 'M-8,-1 L0,-9 L8,-1 Z M8,-1 V9';
const CITY_LINES = 'M-12,-3 L-6,-10 L0,-3 M0,-3 V0 M0,0 H10 V10 M10,0 L15,-4';

function Piece({ kind, color }: { kind: 'settlement' | 'city'; color: string }) {
  const p = kind === 'city' ? CITY : SETTLEMENT;
  return (
    <>
      <path d={p.body} className="building" fill={color} />
      <path d={p.side} className="building-side" />
      <path d={p.roof} className="building-roof" />
      <path d={kind === 'city' ? CITY_LINES : SETTLEMENT_LINES} className="building-line" />
      <path d={p.body} className="building-edge" />
    </>
  );
}

/** Shared filters and terrain textures (small repeating patterns laid over each tile colour). */
const BoardDefs = memo(function BoardDefs() {
  return (
    <>
      <filter id="piece-shadow" x="-30%" y="-30%" width="160%" height="170%">
        <feDropShadow dx="1.5" dy="3" stdDeviation="1.6" floodColor="#000" floodOpacity="0.55" />
      </filter>
      <filter id="board-shadow" x="-10%" y="-10%" width="120%" height="125%">
        <feDropShadow dx="0" dy="10" stdDeviation="10" floodColor="#000" floodOpacity="0.5" />
      </filter>
      <radialGradient id="sea-fill" cx="50%" cy="45%" r="60%">
        <stop offset="0%" stopColor="#3b8fbf" />
        <stop offset="100%" stopColor="#1d5f86" />
      </radialGradient>
      <linearGradient id="wood-fill" x1="0" y1="0" x2="0.3" y2="1">
        <stop offset="0%" stopColor="#c08a52" />
        <stop offset="50%" stopColor="#9a6634" />
        <stop offset="100%" stopColor="#6e4420" />
      </linearGradient>
      <radialGradient id="robber-fill" cx="35%" cy="30%" r="80%">
        <stop offset="0%" stopColor="#6b7078" />
        <stop offset="100%" stopColor="#15171b" />
      </radialGradient>
      <pattern id="tex-forest" width="22" height="20" patternUnits="userSpaceOnUse">
        <path d="M5,14 L9,5 L13,14 Z M14,20 L17,13 L20,20 Z" fill="#1f4d1f" opacity="0.55" />
      </pattern>
      <pattern
        id="tex-fields"
        width="9"
        height="9"
        patternUnits="userSpaceOnUse"
        patternTransform="rotate(-25)"
      >
        <path d="M0,4.5 H9" stroke="#a87f0e" strokeWidth="1.6" opacity="0.5" />
      </pattern>
      <pattern id="tex-pasture" width="16" height="14" patternUnits="userSpaceOnUse">
        <path
          d="M3,9 q1,-3 2,0 q1,-3 2,0 M10,4 q1,-3 2,0 q1,-3 2,0"
          stroke="#4f8a2a"
          strokeWidth="1.1"
          fill="none"
          opacity="0.7"
        />
      </pattern>
      <pattern id="tex-hills" width="16" height="10" patternUnits="userSpaceOnUse">
        <path
          d="M0,0.5 H16 M0,5.5 H16 M4,0.5 V5.5 M12,5.5 V10"
          stroke="#7d3a1c"
          strokeWidth="1"
          opacity="0.45"
        />
      </pattern>
      <pattern id="tex-mountains" width="26" height="18" patternUnits="userSpaceOnUse">
        <path d="M2,16 L9,5 L16,16 Z M13,12 L19,3 L25,12 Z" fill="#5b5e68" opacity="0.5" />
        <path d="M7.5,7.5 L9,5 L10.5,7.5 Z M17.6,5.2 L19,3 L20.4,5.2 Z" fill="#f2f2f2" />
      </pattern>
      <pattern id="tex-desert" width="24" height="12" patternUnits="userSpaceOnUse">
        <path d="M0,8 q6,-5 12,0 t12,0" stroke="#b9a46a" strokeWidth="1.2" fill="none" />
      </pattern>
      <radialGradient id="tile-shine" cx="35%" cy="25%" r="80%">
        <stop offset="0%" stopColor="#fff" stopOpacity="0.28" />
        <stop offset="55%" stopColor="#fff" stopOpacity="0" />
        <stop offset="100%" stopColor="#000" stopOpacity="0.22" />
      </radialGradient>
    </>
  );
});
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
      {!sea && (
        <polygon
          className={`hex-tex tex-${h.terrain}`}
          points={pointsAttr(hexCornerPoints(h.q, h.r, S - 2))}
          aria-hidden="true"
        />
      )}
      {!sea && (
        <polygon
          className="hex-shine"
          points={pointsAttr(hexCornerPoints(h.q, h.r))}
          aria-hidden="true"
        />
      )}
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
          <circle r={S * 0.3} cy={2.5} className="token-shadow" />
          <circle r={S * 0.3} className="token-disc" />
          <circle r={S * 0.3 - 3} className="token-ring" />
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
      <g className="land-sides" aria-hidden="true">
        {land.map((h) => (
          <polygon
            key={h.id}
            className="hex-side"
            points={pointsAttr(hexCornerPoints(h.q, h.r))}
            transform="translate(0 5)"
          />
        ))}
      </g>
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

/** How far the classic board's sea ring and its wooden frame reach, in hex sizes per land hex. */
const FRAME_SEA = 2.2;
const FRAME_WOOD = 2.48;

/**
 * Classic boards float on a sea ring held by a wooden frame, both following the island's convex
 * outline (a hexagon on the standard board). Open Seas boards bring their own sea hexes instead.
 */
const Frame = memo(function Frame({ board }: { board: BoardData }) {
  const poly = (scale: number, cls: string) => (
    <polygon className={cls} points={pointsAttr(landHull(board, scale))} />
  );
  return (
    <g className="board-frame" aria-hidden="true">
      {poly(FRAME_WOOD, 'frame-wood')}
      {poly(FRAME_SEA + 0.08, 'frame-inner')}
      {poly(FRAME_SEA, 'frame-sea')}
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
  const graph = useMemo(() => graphFor(board), [board]);
  const framed = graph.seaEdges.length === 0;
  // A framed board shows the whole frame; the frame's stroke and shadow get a little extra room.
  const vb = useMemo(
    () => (framed ? boundsOf(landHull(board, FRAME_WOOD), 8) : boardViewBox(board)),
    [board, framed],
  );
  const hexById = useMemo(() => new Map(board.hexes.map((h) => [h.id, h])), [board]);
  const robber = hexCenter(view.robber);
  // The pirate sprite spans x ±17, y -21..+11 around its anchor; keep it clear of the cropped rim.
  const pirateHex = view.pirate ? hexCenter(view.pirate) : null;
  const pirate = pirateHex
    ? clampSprite({ x: pirateHex.x, y: pirateHex.y + 4 }, vb, 18, -21, 11)
    : null;
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
        <BoardDefs />
      </defs>
      {framed && <Frame board={board} />}
      {/* Ports under the terrain on classic boards (docks reach out over the sea); on Open
          Seas they sit on inner coasts and must stay above the sea hexes. */}
      {graph.seaEdges.length === 0 && <Ports board={board} graph={graph} />}
      <Terrain board={board} graph={graph} />
      {graph.seaEdges.length > 0 && <Ports board={board} graph={graph} />}

      <g className="roads" filter="url(#piece-shadow)">
        {Object.entries(view.roads).map(([edge, seat]) => {
          const [a, b] = shrinkSegment(...edgePoints(graph, edge), 0.14);
          const xy = { x1: round(a.x), y1: round(a.y), x2: round(b.x), y2: round(b.y) };
          return (
            <g key={edge}>
              <title>{`${nameOf(seat)}'s road`}</title>
              <line {...xy} className="road-outline" />
              <line {...xy} className="road" stroke={colorOf(seat)} />
              <line {...xy} className="road-shine" />
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
          transform={`translate(${round(pirate.x)} ${round(pirate.y)})`}
        >
          <title>Pirate</title>
          <path d={PIRATE_SAIL} className="pirate-sail" />
          <path d={PIRATE_FLAG} className="pirate-flag" />
          <path d={PIRATE_HULL} className="pirate-hull" />
        </g>
      )}

      <g className="buildings" filter="url(#piece-shadow)">
        {Object.entries(view.buildings).map(([v, b]) => {
          const p = vertexPoint(v);
          return (
            <g key={v} transform={`translate(${round(p.x)} ${round(p.y)}) scale(1.3)`}>
              <title>{`${nameOf(b.owner)}'s ${b.kind}`}</title>
              <Piece kind={b.kind} color={colorOf(b.owner)} />
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
                aria-label={
                  picked
                    ? `Your ship ${edgePlace(board, graph.edgeHexes, id)} (selected)`
                    : `Move your ship ${edgePlace(board, graph.edgeHexes, id)}`
                }
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
                aria-label={`${edgeVerb} ${edgePlace(board, graph.edgeHexes, id)}`}
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
