import { useCallback, useMemo, useSyncExternalStore } from 'react';

/** Phone in landscape (or any short viewport): keep in sync with the `max-height` media blocks. */
export const COMPACT_QUERY = '(max-height: 560px)';

/** Subscribe to a CSS media query. False where `matchMedia` is unavailable. */
export function useMediaQuery(query: string): boolean {
  // One MediaQueryList per query, and a stable subscribe, so React does not resubscribe on
  // every render.
  const mql = useMemo(
    () => (typeof matchMedia === 'undefined' ? null : matchMedia(query)),
    [query],
  );
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!mql) return () => {};
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    [mql],
  );
  const getSnapshot = useCallback(() => mql?.matches ?? false, [mql]);
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
