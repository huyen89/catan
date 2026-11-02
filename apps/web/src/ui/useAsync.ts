import { useCallback, useEffect, useState } from 'react';
import { errorMessage } from '../net/emit';

export type AsyncState<T> =
  { status: 'loading' } | { status: 'error'; error: string } | { status: 'ready'; data: T };

/** Run `load` on mount (and whenever `key` changes); ignores results that arrive after unmount. */
export function useAsync<T>(
  load: () => Promise<T>,
  key: string,
): AsyncState<T> & { reload(): void } {
  const [state, setState] = useState<AsyncState<T>>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setState({ status: 'loading' });
    load().then(
      (data) => live && setState({ status: 'ready', data }),
      (e: unknown) => live && setState({ status: 'error', error: errorMessage(e) }),
    );
    return () => {
      live = false;
    };
    // `load` is deliberately not a dependency: callers pass inline closures, `key` identifies it.
  }, [key, attempt]);
  const reload = useCallback(() => setAttempt((a) => a + 1), []);
  return { ...state, reload };
}
