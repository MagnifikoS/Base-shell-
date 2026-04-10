import { useState, useMemo, useRef, useEffect } from "react";

export function useListSearch<T>(items: T[], searchKeys: (keyof T)[], initialQuery = "") {
  const [query, setQuery] = useState(initialQuery);
  const [debouncedQuery, setDebouncedQuery] = useState(initialQuery);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    timerRef.current = setTimeout(() => setDebouncedQuery(query), 200);
    return () => clearTimeout(timerRef.current);
  }, [query]);

  const filteredItems = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) =>
      searchKeys.some((key) => {
        const val = item[key];
        return typeof val === "string" && val.toLowerCase().includes(q);
      })
    );
  }, [items, debouncedQuery, searchKeys]);

  return { query, setQuery, filteredItems };
}
