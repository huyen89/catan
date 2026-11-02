import type { ReactNode } from 'react';
import { Link } from '../common';
import type { AsyncState } from '../useAsync';

/** Simple scrolling page with a title row and a way home. */
export function PageShell(props: { title: string; nav?: ReactNode; children: ReactNode }) {
  return (
    <div className="page">
      <header className="page-head">
        <Link to="/" className="nav-link" testId="nav-home">
          ← Home
        </Link>
        <h1>{props.title}</h1>
        <nav className="page-nav" aria-label="Pages">
          {props.nav}
        </nav>
      </header>
      <main className="page-body">{props.children}</main>
    </div>
  );
}

/** Loading / error (with retry) / ready switch for a useAsync result. */
export function LoadState<T>(props: {
  state: AsyncState<T> & { reload(): void };
  what: string;
  children(data: T): ReactNode;
}) {
  const { state } = props;
  if (state.status === 'loading')
    return (
      <p className="muted" role="status">
        Loading {props.what}…
      </p>
    );
  if (state.status === 'error')
    return (
      <div className="load-error" role="alert">
        <p className="error">
          Couldn’t load {props.what}: {state.error}
        </p>
        <button type="button" onClick={state.reload}>
          Try again
        </button>
      </div>
    );
  return <>{props.children(state.data)}</>;
}
