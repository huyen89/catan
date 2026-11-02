import { useSyncExternalStore } from 'react';

/** Phone in landscape (or any short viewport): keep in sync with the `max-height` media blocks. */
export const COMPACT_QUERY = '(max-height: 560px)';

/** Subscribe to a CSS media query. False where `matchMedia` is unavailable. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof matchMedia === 'undefined') return () => {};
      const mql = matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    () => (typeof matchMedia === 'undefined' ? false : matchMedia(query).matches),
    () => false,
  );
}
