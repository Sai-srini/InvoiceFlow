import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from './api';

/** Loads data from the API. `path` may be null to skip. Reload with reload(). */
export function useApi<T = any>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!path);
  const load = useCallback(async () => {
    if (!path) { setData(null); setLoading(false); return; }
    setLoading(true); setError(null);
    try { setData(await api<T>(path)); } catch (e) { setError(e instanceof ApiError ? e.message : 'Could not load data.'); } finally { setLoading(false); }
  }, [path]);
  useEffect(() => { load(); }, [load]);
  return { data, error, loading, reload: load, setData };
}
export const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Something went wrong.');
