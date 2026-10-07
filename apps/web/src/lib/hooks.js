import { useCallback, useEffect, useRef, useState } from 'react';

/** Fetch data with loading/error state and a reload function. */
export function useFetch(fn, deps = []) {
  const [state, setState] = useState({ data: null, meta: null, loading: true, error: null });
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const r = await fnRef.current();
      setState({ data: r?.data ?? r, meta: r?.meta ?? null, loading: false, error: null });
    } catch (e) {
      setState({ data: null, meta: null, loading: false, error: e.message });
    }
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, deps);
  return { ...state, reload: load };
}

/** Wrap an async action with busy + error state. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const run = async (fn) => {
    setBusy(true); setError(null);
    try { return await fn(); } catch (e) { setError(e.message); return undefined; } finally { setBusy(false); }
  };
  return { busy, error, run, setError };
}
