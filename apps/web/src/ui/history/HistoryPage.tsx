import { RESULT_LABEL, formatDateTime, historyRow } from '../../game/history';
import { api } from '../../net/api';
import { replayPath } from '../../router';
import { Link } from '../common';
import { useAsync } from '../useAsync';
import { PageShell, LoadState } from './PageShell';

export function HistoryPage() {
  const games = useAsync(() => api.games(), 'games');
  return (
    <PageShell
      title="Game history"
      nav={
        <Link to="/stats" className="nav-link" testId="nav-stats">
          Your stats
        </Link>
      }
    >
      <LoadState state={games} what="your games">
        {(data) =>
          data.games.length === 0 ? (
            <p className="muted" data-testid="history-empty">
              No games yet. Finished games will show up here.
            </p>
          ) : (
            <ul className="history-list" data-testid="history-list">
              {data.games.map((g) => {
                const row = historyRow(g);
                return (
                  <li key={row.gameId} className={`history-item ${row.result}`}>
                    <div className="history-head">
                      <span className={`result-tag ${row.result}`}>{RESULT_LABEL[row.result]}</span>
                      <time dateTime={new Date(row.when).toISOString()}>
                        {formatDateTime(row.when)}
                      </time>
                      <span className="muted">{row.variant}</span>
                      <span className="muted">{row.turns} turns</span>
                    </div>
                    <ul className="history-players" aria-label="Players">
                      {row.players.map((p, i) => (
                        <li key={i} className={p.winner ? 'winner' : undefined}>
                          {p.winner && (
                            <span className="crown" aria-label="Winner" title="Winner">
                              ★
                            </span>
                          )}
                          <span className={p.me ? 'me' : undefined}>{p.name}</span>
                          {p.bot && <span className="badge ai">AI</span>}
                          {p.vp !== null && <span className="muted"> {p.vp} VP</span>}
                        </li>
                      ))}
                    </ul>
                    <div className="history-foot">
                      <span>
                        {row.winnerName ? (
                          <>
                            Winner: <strong>{row.winnerName}</strong>
                          </>
                        ) : (
                          <span className="muted">No winner</span>
                        )}
                        {row.myVp !== null && (
                          <>
                            {' · '}You: <strong>{row.myVp} VP</strong>
                          </>
                        )}
                      </span>
                      {row.canReplay && (
                        <Link
                          to={replayPath(row.gameId)}
                          className="button-link"
                          testId={`replay-${row.gameId}`}
                        >
                          Watch replay
                        </Link>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )
        }
      </LoadState>
    </PageShell>
  );
}
