import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';

import { friendlyError } from './errors';

/**
 * Loads data when the screen gains focus and whenever `loader` changes identity (wrap it in
 * useCallback). Out-of-order responses are discarded, and errors arrive as safe sentences.
 */
export function useAsyncData<T>(loader: () => Promise<T>, errorMessage: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const latestRequest = useRef(0);

  const load = useCallback(
    async (pulled: boolean) => {
      const request = ++latestRequest.current;
      if (pulled) setRefreshing(true);
      try {
        const result = await loader();
        if (request !== latestRequest.current) return;
        setData(result);
        setError(null);
      } catch (caught) {
        if (request !== latestRequest.current) return;
        setError(friendlyError(caught, errorMessage));
      } finally {
        if (request === latestRequest.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [loader, errorMessage],
  );

  useFocusEffect(
    useCallback(() => {
      void load(false);
    }, [load]),
  );

  const reload = useCallback(() => load(false), [load]);
  const refresh = useCallback(() => load(true), [load]);

  return { data, setData, error, setError, loading, refreshing, reload, refresh };
}
