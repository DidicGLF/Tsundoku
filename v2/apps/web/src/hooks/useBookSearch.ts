import { useCallback, useRef, useState, type FormEvent } from "react";
import type { BookSearchResult } from "@tsundoku/book-sources";
import {
  enrichSearchResults, friendlySearchError, mergeSearchResults, searchBooks, searchCompleteAuthorBibliography, searchSimilarBooks,
  type BookSearchField, type BookSearchLanguage, type SearchProvider, type SimilarBooksQuery
} from "../services/bookSearch";
import { hasGoogleBooksApiKey } from "../services/credentials";
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
  const [notice, setNotice] = useState("");
  /** Recherche « même éditeur / collection / auteur » en cours, avec son libellé. */
  const [similar, setSimilar] = useState<{ label: string; query: SimilarBooksQuery } | null>(null);
  /** Recherche terminée (même sans résultat) : sert à afficher « aucun résultat » et l'ajout manuel. */
  const [searched, setSearched] = useState<{ q: string; field: BookSearchField } | null>(null);

  /** Recherche de jaquettes en arrière-plan en cours pour la recherche affichée. */
  const [coversRunning, setCoversRunning] = useState(false);
  const runningCovers = useRef(0);

  // Chaque recherche a un numéro : les réponses tardives d'une recherche abandonnée sont ignorées.
  const currentSearch = useRef(0);

  const enrichInBackground = useCallback((found: BookSearchResult[], language: BookSearchLanguage, searchId: number) => {
    // L'enrichissement (jaquettes/métadonnées) ne doit jamais bloquer la recherche :
    // les jaquettes apparaissent au fil de l'eau, étape par étape.
    const merge = (partial: BookSearchResult[]) => {
      if (searchId === currentSearch.current) setResults(current => mergeSearchResults([...current, ...partial]));
    };
    runningCovers.current++;
    setCoversRunning(true);
    const finish = () => {
      if (searchId !== currentSearch.current) return; // recherche abandonnée : son compteur a été remis à zéro
      runningCovers.current = Math.max(0, runningCovers.current - 1);
      if (runningCovers.current === 0) setCoversRunning(false);
    };
    void enrichSearchResults(found, language, merge).then(merge).catch(() => undefined).finally(finish);
  }, []);

  const resetCovers = () => { runningCovers.current = 0; setCoversRunning(false); };

  const run = useCallback(async (language: BookSearchLanguage, showOthers: boolean) => {
    const searchId = ++currentSearch.current;
    const isCurrent = () => searchId === currentSearch.current;
    resetCovers();
    setBusy(true);
    setError("");
    setNotice("");
    setSearched(null);
    setSimilar(null);
    setResults([]);
    setShowOtherLanguages(showOthers);
    setCanLoadMore(false);
    setActiveLanguage(language);
    setNoPreferredResults(false);
    // Les résultats s'affichent dès que la première source répond.
    const progress = (partial: BookSearchResult[]) => { if (isCurrent()) setResults(partial); };
    try {
      const found = field === "author"
        ? await searchCompleteAuthorBibliography(q, provider, language, false, progress, message => { if (isCurrent()) setNotice(message); })
        : await searchBooks(q, provider, language, 0, field, progress, message => { if (isCurrent()) setNotice(message); });
      if (!isCurrent()) return;
      setResults(found);
      setOffset(PAGE_SIZE);
      setCanLoadMore(field !== "author" && found.length > 0);
      setNoPreferredResults(!showOthers && language !== "all" && field !== "isbn" && found.length === 0);
      setSearched({ q: q.trim(), field });
      enrichInBackground(found, language, searchId);
    } catch (x) {
      const hasKey = await hasGoogleBooksApiKey().catch(() => false);
      if (isCurrent()) setError(friendlySearchError(x, hasKey));
    } finally {
      if (isCurrent()) setBusy(false);
    }
  }, [q, provider, field, enrichInBackground]);

  /** Repart d'une recherche vierge : champ vide, résultats effacés, recherche en cours abandonnée. */
  const clear = useCallback(() => {
    currentSearch.current++;
    resetCovers();
    setQ("");
    setResults([]);
    setOffset(0);
    setCanLoadMore(false);
    setNoPreferredResults(false);
    setShowOtherLanguages(false);
    setError("");
    setNotice("");
    setSearched(null);
    setSimilar(null);
    setBusy(false);
  }, []);

  /** Affiche les autres livres du même éditeur / de la même collection / du même auteur. */
  const runSimilar = useCallback(async (label: string, query: SimilarBooksQuery) => {
    const searchId = ++currentSearch.current;
    const isCurrent = () => searchId === currentSearch.current;
    resetCovers();
    setBusy(true);
    setError("");
    setNotice("");
    setResults([]);
    setQ("");
    setSimilar({ label, query });
    setSearched(null);
    setShowOtherLanguages(false);
    setNoPreferredResults(false);
    setActiveLanguage(preferredLanguage);
    try {
      const { books, hasMore } = await searchSimilarBooks(query, 0, preferredLanguage);
      if (!isCurrent()) return;
      setResults(books);
      setOffset(100);
      setCanLoadMore(hasMore);
      setSearched({ q: label, field: "all" });
      enrichInBackground(books, preferredLanguage, searchId);
    } catch (x) {
      const hasKey = await hasGoogleBooksApiKey().catch(() => false);
      if (isCurrent()) setError(friendlySearchError(x, hasKey));
    } finally {
      if (isCurrent()) setBusy(false);
    }
  }, [preferredLanguage, enrichInBackground]);

  const submit = useCallback((e: FormEvent) => { e.preventDefault(); void run(preferredLanguage, false); }, [run, preferredLanguage]);
  const searchAllLanguages = useCallback(() => run("all", true), [run]);

  const loadMore = useCallback(async () => {
    if (busy || !canLoadMore) return;
    setBusy(true);
    setError("");
    try {
      const searchId = currentSearch.current;
      if (similar) {
        const { books, hasMore } = await searchSimilarBooks(similar.query, offset, activeLanguage);
        if (searchId !== currentSearch.current) return;
        setResults(current => mergeSearchResults([...current, ...books]));
        setOffset(current => current + 100);
        setCanLoadMore(hasMore);
        enrichInBackground(books, activeLanguage, searchId);
        return;
      }
      const found = await searchBooks(q, provider, activeLanguage, offset, field);
      if (searchId !== currentSearch.current) return;
      setResults(current => mergeSearchResults([...current, ...found]));
      setOffset(current => current + PAGE_SIZE);
      setCanLoadMore(found.length > 0);
      enrichInBackground(found, activeLanguage, searchId);
    } catch (x) {
      setError(x instanceof Error ? x.message : "Recherche impossible");
    } finally {
      setBusy(false);
    }
  }, [busy, canLoadMore, q, provider, activeLanguage, offset, field, similar, enrichInBackground]);

  return {
    q, setQ, provider, setProvider, field, setField,
    results, canLoadMore, activeLanguage, showOtherLanguages, setShowOtherLanguages,
    noPreferredResults, busy, coversRunning, error, notice, searched, similar,
    submit, searchAllLanguages, loadMore, clear, runSimilar
  };
}

export type BookSearch = ReturnType<typeof useBookSearch>;
