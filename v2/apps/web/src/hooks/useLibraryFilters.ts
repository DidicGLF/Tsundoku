import { useCallback, useState } from "react";
import type { LibraryFilter, LibrarySort } from "../lib/library-view";

/** Filtres de la bibliothèque, conservés quand on ouvre un livre puis qu'on revient. */
export function useLibraryFilters() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<LibraryFilter>("ALL");
  const [sort, setSort] = useState<LibrarySort>("RECENT");
  const clear = useCallback(() => { setQuery(""); setFilter("ALL"); }, []);
  return { query, setQuery, filter, setFilter, sort, setSort, clear };
}

export type LibraryFilters = ReturnType<typeof useLibraryFilters>;
