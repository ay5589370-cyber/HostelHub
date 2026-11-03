import { useCallback, useEffect, useRef, useState } from "react";
export function useQuery(fetcher) {
  const [state, setState] = useState({
    data: null,
    loading: true,
    error: null,
  });
  const ticket = useRef(0);
  const reload = useCallback(async () => {
    const current = ++ticket.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fetcher();
      if (current === ticket.current)
        setState({ data, loading: false, error: null });
    } catch (error) {
      if (current === ticket.current)
        setState({ data: null, loading: false, error });
    }
  }, [fetcher]);
  useEffect(() => {
    const requestTicket = ticket;
    void reload();
    return () => {
      requestTicket.current++;
    };
  }, [reload]);
  return { ...state, reload };
}
