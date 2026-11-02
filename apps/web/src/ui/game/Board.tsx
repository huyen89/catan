import { memo, useMemo, type KeyboardEvent } from 'react';
import {
  graphFor,
  type Board as BoardData,
  type BoardGraph,
  type PlayerView,
  type Seat,
} from '@hexhaven/engine';
import {
  HEX_SIZE,
  boardViewBox,
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
import type { Highlights } from '../../game/highlights';
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
  onHex(id: string): void;
}

const S = HEX_SIZE;
const SETTLEMENT_PATH = 'M-9,9 L-9,-2 L0,-11 L9,-2 L9,9 Z';
const CITY_PATH = 'M-14,11 V-3 L-7,-11 L0,-3 V-1 H14 V11 Z';
const ROBBER_PATH = 'M-8,14 C-8,4 -6,0 -4,-2 A6.5,6.5 0 1 1 4,-2 C6,0 8,4 8,14 Z';

function activate(fn: () => void) {
  return (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fn();
    }
  };
}

/** Static layers (terrain, tokens, ports) only change when the board does. */
const Terrain = memo(function Terrain({ board }: { board: BoardData }) {
  return (
    <g className="terrain">
      {board.hexes.map((h) => {
        const c = hexCenter(h.id);
        const glyph = TERRAIN_GLYPH[h.terrain];
        return (
          <g key={h.id}>
            <polygon
              className={`hex hex-${h.terrain}`}
              points={pointsAttr(hexCornerPoints(h.q, h.r))}
            />
            {glyph && (
              <g
                transform={`translate(${round(c.x)} ${round(c.y - S * (h.token ? 0.5 : 0))}) scale(${h.token ? 0.85 : 1.4})`}
                className="hex-glyph"
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
      })}
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
  const hexLabel = (id: string) => {
    const h = hexById.get(id);
    return h ? `${TERRAIN_LABEL[h.terrain]}${h.token ? ` ${h.token}` : ''}` : id;
  };

  return (
    <svg
      className={disabled ? 'board busy' : 'board'}
      data-testid="board"
      viewBox={viewBoxAttr(vb)}
      preserveAspectRatio="xMidYMid meet"
      role="group"
      aria-label="Game board"
    >
      <Ports board={board} graph={graph} />
      <Terrain board={board} />

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

      <g
        className="robber"
        transform={`translate(${round(robber.x - S * 0.5)} ${round(robber.y + 2)})`}
      >
        <title>Robber</title>
        <path d={ROBBER_PATH} />
      </g>

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

      {hl.hexes.length > 0 && (
        <g className="hl-hexes">
          {hl.hexes.map((id) => {
            const h = hexById.get(id);
            if (!h) return null;
            const c = hexCenter(id);
            return (
              <g
                key={id}
                data-testid={`hex-${id}`}
                className="hl hl-hex"
                role="button"
                tabIndex={0}
                aria-label={`Move the robber to ${hexLabel(id)}`}
                aria-disabled={disabled}
                onClick={() => props.onHex(id)}
                onKeyDown={activate(() => props.onHex(id))}
              >
                <polygon points={pointsAttr(hexCornerPoints(h.q, h.r, S * 0.9))} />
                <circle cx={round(c.x - S * 0.5)} cy={round(c.y + 6)} r={9} />
              </g>
            );
          })}
        </g>
      )}

      {hl.edges.length > 0 && (
        <g className="hl-edges">
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
                aria-label={`Build a road at ${id}`}
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
