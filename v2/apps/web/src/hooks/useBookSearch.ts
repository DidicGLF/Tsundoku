import { useCallback, useState, type FormEvent } from "react";
import type { BookSearchResult } from "@tsundoku/book-sources";
import {
  enrichSearchResults, mergeSearchResults, searchBooks, searchCompleteAuthorBibliography,
  type BookSearchField, type BookSearchLanguage, type SearchProvider
} from "../services/bookSearch";
import { usePreferences } from "../state/PreferencesProvider";

const PAGE_SIZE = 40;

/** État de la recherche, conservé quand on ouvre un auteur puis qu'on revient. */
export function useBookSearch() {
  const { preferredLanguage } = usePreferences();
  const [q, setQ] = useState("");
  const [provider, setProvider] = useState<SearchProvider>("all");
  const [field, setField] = useState<BookSearchField>("all");
  const [results, setResults] = useState<BookSearchResult[]>([]);
  const [offset, setOffset] = useState(0);
  const [canLoadMore, setCanLoadMore] = useState(false);
  const [activeLanguage, setActiveLanguage] = useState<BookSearchLanguage>(preferredLanguage);
  const [showOtherLanguages, setShowOtherLanguages] = useState(false);
  const [noPreferredResults, setNoPreferredResults] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const enrichInBackground = useCallback((found: BookSearchResult[], language: BookSearchLanguage) => {
    // L'enrichissement (jaquettes/métadonnées) ne doit jamais bloquer la recherche.
    void enrichSearchResults(found, language)
      .then(enriched => setResults(current => mergeSearchResults([...current, ...enriched])))
      .catch(() => undefined);
  }, []);

  const run = useCallback(async (language: BookSearchLanguage, showOthers: boolean) => {
    setBusy(true);
    setError("");
    try {
      const found = field === "author"
        ? await searchCompleteAuthorBibliography(q, provider, language)
        : await searchBooks(q, provider, language, 0, field);
      setResults(found);
      setShowOtherLanguages(showOthers);
      setOffset(PAGE_SIZE);
      setCanLoadMore(field !== "author" && found.length > 0);
      setActiveLanguage(language);
      setNoPreferredResults(!showOthers && language !== "all" && found.length === 0);
      enrichInBackground(found, language);
    } catch (x) {
      setError(x instanceof Error ? x.message : "Recherche impossible");
    } finally {
      setBusy(false);
    }
  }, [q, provider, field, enrichInBackground]);

  const submit = useCallback((e: FormEvent) => { e.preventDefault(); void run(preferredLanguage, false); }, [run, preferredLanguage]);
  const searchAllLanguages = useCallback(() => run("all", true), [run]);

  const loadMore = useCallback(async () => {
    if (busy || !canLoadMore) return;
    setBusy(true);
    setError("");
    try {
      const found = await searchBooks(q, provider, activeLanguage, offset, field);
      setResults(current => mergeSearchResults([...current, ...found]));
      setOffset(current => current + PAGE_SIZE);
      setCanLoadMore(found.length > 0);
      enrichInBackground(found, activeLanguage);
    } catch (x) {
      setError(x instanceof Error ? x.message : "Recherche impossible");
    } finally {
      setBusy(false);
    }
  }, [busy, canLoadMore, q, provider, activeLanguage, offset, field, enrichInBackground]);

  return {
    q, setQ, provider, setProvider, field, setField,
    results, canLoadMore, activeLanguage, showOtherLanguages, setShowOtherLanguages,
    noPreferredResults, busy, error,
    submit, searchAllLanguages, loadMore
  };
}

export type BookSearch = ReturnType<typeof useBookSearch>;
