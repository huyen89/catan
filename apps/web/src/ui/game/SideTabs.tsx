import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { ChatIcon, LogIcon, PeopleIcon, TradeIcon } from '../icons';

export type SideTab = 'players' | 'trade' | 'log' | 'chat';

const TABS: Array<{ id: SideTab; label: string; icon: ReactNode }> = [
  { id: 'players', label: 'Players', icon: <PeopleIcon /> },
  { id: 'trade', label: 'Trade', icon: <TradeIcon /> },
  { id: 'log', label: 'Log', icon: <LogIcon /> },
  { id: 'chat', label: 'Chat', icon: <ChatIcon /> },
];

/**
 * The side column. Full layout: every pane stacked. Compact (phone landscape): a vertical tab
 * rail plus one visible pane; selecting the open tab again collapses it so the board gets the
 * full width. Both layouts render the same keyed elements, so switching layout (rotating the
 * phone) or tabs never remounts a pane: the voice bar would leave the call, and the trade draft
 * and chat input would be lost.
 */
export function SideTabs(props: {
  compact: boolean;
  tab: SideTab | null;
  onTab(tab: SideTab | null): void;
  panes: Record<SideTab, ReactNode>;
  tradeBadge: number;
}) {
  const { compact, tab, onTab, panes, tradeBadge } = props;
  const base = useId();
  const tabs = TABS.filter((t) => panes[t.id] !== null);
  const refs = useRef<Partial<Record<SideTab, HTMLButtonElement | null>>>({});
  const active = tab !== null && panes[tab] !== null ? tab : null;

  const onKey = (e: KeyboardEvent, i: number) => {
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
    let next: number | undefined;
    if (step) next = (i + step + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    if (next === undefined) return;
    e.preventDefault();
    const t = tabs[next]!;
    refs.current[t.id]?.focus();
    onTab(t.id);
  };

  return (
    <aside className={compact ? `game-side compact ${active ? 'open' : 'closed'}` : 'game-side'}>
      <div
        key="tabs"
        className="side-tabs"
        role="tablist"
        aria-label="Side panels"
        aria-orientation="vertical"
        hidden={!compact}
      >
        {tabs.map((t, i) => {
          const selected = active === t.id;
          const badge = t.id === 'trade' && tradeBadge > 0 ? tradeBadge : 0;
          return (
            <button
              key={t.id}
              ref={(el) => {
                refs.current[t.id] = el;
              }}
              type="button"
              role="tab"
              id={`${base}-tab-${t.id}`}
              aria-selected={selected}
              aria-controls={`${base}-pane-${t.id}`}
              aria-expanded={selected}
              aria-label={badge ? `${t.label} (${badge} waiting for you)` : t.label}
              title={selected ? `Hide ${t.label.toLowerCase()}` : t.label}
              tabIndex={selected || (active === null && i === 0) ? 0 : -1}
              data-testid={`side-tab-${t.id}`}
              className={selected ? 'side-tab on' : 'side-tab'}
              onClick={() => onTab(selected ? null : t.id)}
              onKeyDown={(e) => onKey(e, i)}
            >
              {t.icon}
              {badge > 0 && (
                <span className="tab-badge" aria-hidden="true">
                  {badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {tabs.map((t) => (
        <div
          key={t.id}
          className="side-pane"
          role={compact ? 'tabpanel' : undefined}
          id={`${base}-pane-${t.id}`}
          aria-labelledby={compact ? `${base}-tab-${t.id}` : undefined}
          hidden={compact && active !== t.id}
        >
          {panes[t.id]}
        </div>
      ))}
    </aside>
  );
}
