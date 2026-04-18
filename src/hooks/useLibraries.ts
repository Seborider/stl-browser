import { useCallback, useEffect, useState } from "react";
import type { Library } from "../generated";
import { listLibraries } from "../ipc/commands";

// Minimal fetch-on-mount hook. No caching library; Phase 2's library list is
// tiny and changes only when the user clicks add/remove, so we just refetch
// after any mutation. A richer invalidation story lands with the Phase 3
// `scan:*` / `files:*` events.
export function useLibraries() {
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const next = await listLibraries();
      setLibraries(next);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { libraries, error, loading, refresh };
}
