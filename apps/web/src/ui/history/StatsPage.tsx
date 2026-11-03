import { formatAverage, formatPercent, opponentStats, variantStats } from '../../game/history';
import { api } from '../../net/api';
import { Link } from '../common';
import { useAsync } from '../useAsync';
import { LoadState, PageShell } from './PageShell';

export function StatsPage() {
  const stats = useAsync(() => api.stats(), 'stats');
  return (
    <PageShell
      title="Your stats"
      nav={
        <Link to="/history" className="nav-link" testId="nav-history">
          Game history
        </Link>
      }
    >
      <LoadState state={stats} what="your stats">
        {(s) => {
          const variants = variantStats(s);
          const opponents = opponentStats(s);
          return (
            <div className="stats" data-testid="stats">
              <dl className="stat-tiles">
                <div>
                  <dt>Played</dt>
                  <dd data-testid="stat-played">{s.played}</dd>
                </div>
                <div>
                  <dt>Won</dt>
                  <dd data-testid="stat-won">{s.won}</dd>
                </div>
                <div>
                  <dt>Win rate</dt>
                  <dd data-testid="stat-winrate">{formatPercent(s.won, s.played)}</dd>
                </div>
                <div>
                  <dt>Average VP</dt>
                  <dd data-testid="stat-avgvp">{formatAverage(s.avgVp, s.played)}</dd>
                </div>
              </dl>

              {s.played === 0 && <p className="muted">Finish a game to start collecting stats.</p>}

              {variants.length > 0 && (
                <section className="panel">
                  <h2 id="by-variant">By board</h2>
                  <table className="data-table" aria-labelledby="by-variant">
                    <thead>
                      <tr>
                        <th scope="col">Board</th>
                        <th scope="col">Played</th>
                        <th scope="col">Won</th>
                        <th scope="col">Win rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {variants.map((v) => (
                        <tr key={v.variant}>
                          <th scope="row">{v.label}</th>
                          <td>{v.played}</td>
                          <td>{v.won}</td>
                          <td>{v.winRate}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              )}

              {opponents.length > 0 && (
                <section className="panel">
                  <h2 id="h2h">Head to head</h2>
                  <table className="data-table" aria-labelledby="h2h" data-testid="h2h">
                    <thead>
                      <tr>
                        <th scope="col">Player</th>
                        <th scope="col">Games together</th>
                        <th scope="col">You won</th>
                        <th scope="col">They won</th>
                        <th scope="col">Record</th>
                      </tr>
                    </thead>
                    <tbody>
                      {opponents.map((o) => (
                        <tr key={o.userId} className={`edge-${o.edge}`}>
                          <th scope="row">{o.name}</th>
                          <td>{o.games}</td>
                          <td>{o.yourWins}</td>
                          <td>{o.theirWins}</td>
                          <td>{o.record}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              )}
            </div>
          );
        }}
      </LoadState>
    </PageShell>
  );
}
