import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Capacitor } from "@capacitor/core";
import { App as CapacitorApp } from "@capacitor/app";
import { canonicalAuthorDisplay, canonicalAuthorIdentity, canonicalAuthorSort, collapseToWorks, isSameWork, normalizeText, type BookSearchResult } from "@tsundoku/book-sources";
import type { ReadingStatus } from "@tsundoku/database";
import { enrichSearchResults, getBookLanguageGroup, getBookLanguageLabel, mergeSearchResults, searchBooks, searchCompleteAuthorBibliography, type BookSearchField, type BookSearchLanguage, type SearchProvider } from "./services/bookSearch";
import { getPreferredBookLanguage, setPreferredBookLanguage } from "./services/preferences";
import { deleteGoogleBooksApiKey, hasGoogleBooksApiKey, saveGoogleBooksApiKey } from "./services/credentials";
import {
  addBookToLibrary,
  addBooksToLibrary,
  initializeLibrary,
  removeBookFromLibrary,
  removeBooksFromLibrary,
  refreshLibraryMetadata,
  updateLibraryBook,
  getFollowedAuthor,
  saveFollowedAuthor,
  removeFollowedAuthor,
  clearNewlyDiscoveredBooks,
  getReadingSessions,
  addReadingSession,
  type LibraryBook,
  type ReadingSession
} from "./services/library";
import "./styles.css";

const statusLabels: Record<ReadingStatus, string> = {
  TO_READ: "À lire",
  READING: "En cours",
  READ: "Lu",
  ON_HOLD: "En pause",
  ABANDONED: "Abandonné"
};

type LibraryFilter = "ALL" | ReadingStatus | "FAVORITES" | "OWNED" | "MISSING";
type AuthorBookFilter = "ALL" | "MISSING" | "OWNED" | "READ" | "TO_READ";
type AuthorBookSort = "MISSING" | "TITLE" | "DATE";
type LibrarySort = "RECENT" | "TITLE" | "AUTHOR" | "PROGRESS";

function SearchCard({ b, onAdd, onTrack, added }: {
  b: BookSearchResult; onAdd?: (b: BookSearchResult) => void; onTrack?: (b: BookSearchResult) => void; added?: boolean;
}) {
  return <article className="card">
    {b.coverUrl ? <img src={b.coverUrl} alt="" /> : <div className="cover">📖</div>}
    <div>
      <small>{b.source === "google-books" ? "Google Books" : b.source === "bnf" ? "BnF" : "Open Library"} · <span className="language-badge">{getBookLanguageLabel(b)}</span></small>
      <h3>{b.title}</h3>
      <p>{displayAuthors(b.authors)}</p>
      {onAdd && <div className="card-actions"><button disabled={added} onClick={() => onAdd(b)}>{added ? "Ajouté" : "Je le possède"}</button>{onTrack && !added && <button className="secondary-inline" onClick={() => onTrack(b)}>Je ne le possède pas</button>}</div>}
    </div>
  </article>;
}

function LibraryCard({ b, onOpen }: { b: LibraryBook; onOpen: (b: LibraryBook) => void }) {
  const progress = b.progressTotal && b.progressValue != null
    ? Math.min(100, Math.round((b.progressValue / b.progressTotal) * 100))
    : undefined;

  return <article className="card library-card" onClick={() => onOpen(b)}>
    {b.coverUrl ? <img src={b.coverUrl} alt="" /> : <div className="cover">📖</div>}
    <div>
      <small>{b.owned ? "✓ Possédé" : "○ Non possédé"} · {statusLabels[b.status]} {b.favorite ? "★" : ""}</small>
      <h3>{b.title}</h3>
      <p>{displayAuthors(b.authors)}</p>
      {progress != null && <div className="progress"><i style={{ width: `${progress}%` }} /></div>}
      {progress != null && <p>{progress}% · {b.progressValue}/{b.progressTotal}</p>}
    </div>
  </article>;
}


function displayAuthors(authors: string[]): string {
  const values = authors.map(canonicalAuthorDisplay).filter(name => name && name !== "Auteur inconnu");
  return values.join(", ") || "Auteur inconnu";
}
function countStatus(library: LibraryBook[], status: ReadingStatus) {
  return library.filter(book => book.status === status).length;
}

function progressPercent(book: LibraryBook) {
  if (!book.progressTotal || book.progressValue == null) return -1;
  return Math.min(100, (book.progressValue / book.progressTotal) * 100);
}

function primaryAuthor(book: LibraryBook): string {
  return canonicalAuthorDisplay(book.authors[0] ?? "");
}

function authorSortKey(author: string): string {
  return canonicalAuthorSort(author);
}

function authorInitial(author: string): string {
  const key = authorSortKey(author).trim();
  const first = key[0]?.toUpperCase() ?? "#";
  return /^[A-Z]$/.test(first) ? first : "#";
}

function localDateTimeValue(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function formatSessionDate(value: string) {
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function formatRefreshDate(value?: string) {
  if (!value) return "Jamais";
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export default function App() {
  const [view, setView] = useState<"home" | "library" | "add" | "author" | "detail" | "settings">("home");
  const [library, setLibrary] = useState<LibraryBook[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dbState, setDbState] = useState<"loading" | "ready" | "error">("loading");
  const [dbError, setDbError] = useState("");
  const [q, setQ] = useState("");
  const [provider, setProvider] = useState<SearchProvider>("all");
  const [searchField, setSearchField] = useState<BookSearchField>("all");
  const [searchOffset, setSearchOffset] = useState(0);
  const [canLoadMore, setCanLoadMore] = useState(false);
  const [activeSearchLanguage, setActiveSearchLanguage] = useState<BookSearchLanguage>(() => getPreferredBookLanguage());
  const [preferredLanguage, setPreferredLanguageState] = useState<BookSearchLanguage>(() => getPreferredBookLanguage());
  const [lastSearchHadNoPreferredResults, setLastSearchHadNoPreferredResults] = useState(false);
  const [results, setResults] = useState<BookSearchResult[]>([]);
  const [showOtherLanguages, setShowOtherLanguages] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [libraryQuery, setLibraryQuery] = useState("");
  const [libraryFilter, setLibraryFilter] = useState<LibraryFilter>("ALL");
  const [librarySort, setLibrarySort] = useState<LibrarySort>("RECENT");
  const [googleKey, setGoogleKey] = useState("");
  const [googleKeyConfigured, setGoogleKeyConfigured] = useState(false);
  const [credentialBusy, setCredentialBusy] = useState(false);
  const [credentialMessage, setCredentialMessage] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [authorDeleteBusy, setAuthorDeleteBusy] = useState(false);
  const [sessions, setSessions] = useState<ReadingSession[]>([]);
  const [sessionDate, setSessionDate] = useState(() => localDateTimeValue());
  const [sessionDuration, setSessionDuration] = useState(30);
  const [sessionEndProgress, setSessionEndProgress] = useState("");
  const [sessionNotes, setSessionNotes] = useState("");
  const [sessionBusy, setSessionBusy] = useState(false);
  const [selectedAuthorKey, setSelectedAuthorKey] = useState<string | null>(null);
  const [selectedAuthorName, setSelectedAuthorName] = useState("");
  const [authorBookFilter, setAuthorBookFilter] = useState<AuthorBookFilter>("ALL");
  const [authorBookSort, setAuthorBookSort] = useState<AuthorBookSort>("MISSING");
  const [authorRefreshBusy, setAuthorRefreshBusy] = useState(false);
  const [authorLastRefreshedAt, setAuthorLastRefreshedAt] = useState<string | undefined>();
  const [authorRefreshMessage, setAuthorRefreshMessage] = useState("");

  const selected = library.find(b => b.id === selectedId);
  const authorBibliography = useMemo(() => {
    if (searchField !== "author") return [];
    const languageVisible = activeSearchLanguage === "all" ? results : results.filter(book => getBookLanguageGroup(book, activeSearchLanguage) === "preferred");
    return collapseToWorks(languageVisible);
  }, [results, searchField, activeSearchLanguage]);
  const authorSearchGroups = useMemo(() => {
    const groups = new Map<string, { key: string; name: string; books: BookSearchResult[] }>();
    for (const book of authorBibliography) {
      const raw = book.authors[0] ?? q.trim();
      const name = canonicalAuthorDisplay(raw);
      const key = canonicalAuthorIdentity(raw || name);
      if (!key) continue;
      const current = groups.get(key);
      if (current) current.books.push(book);
      else groups.set(key, { key, name, books: [book] });
    }
    return [...groups.values()]
      .map(group => ({ ...group, books: collapseToWorks(group.books) }))
      .sort((a, b) => b.books.length - a.books.length || authorSortKey(a.name).localeCompare(authorSortKey(b.name), "fr"));
  }, [authorBibliography, q]);
  const selectedAuthorBooks = useMemo(() => {
    if (!selectedAuthorKey) return [];
    return library.filter(book => canonicalAuthorIdentity(book.authors[0] ?? "") === selectedAuthorKey);
  }, [library, selectedAuthorKey]);

  const visibleAuthorBooks = useMemo(() => {
    const filtered = selectedAuthorBooks.filter(book => {
      if (authorBookFilter === "MISSING") return !book.owned;
      if (authorBookFilter === "OWNED") return book.owned;
      if (authorBookFilter === "READ") return book.status === "READ";
      if (authorBookFilter === "TO_READ") return book.status !== "READ";
      return true;
    });
    return [...filtered].sort((a, b) => {
      if (authorBookSort === "TITLE") return a.title.localeCompare(b.title, "fr");
      if (authorBookSort === "DATE") return (b.publishedYear ?? -1) - (a.publishedYear ?? -1) || a.title.localeCompare(b.title, "fr");
      return Number(a.owned) - Number(b.owned) || a.title.localeCompare(b.title, "fr");
    });
  }, [selectedAuthorBooks, authorBookFilter, authorBookSort]);

  const selectedAuthorOwned = selectedAuthorBooks.filter(book => book.owned).length;
  const selectedAuthorRead = selectedAuthorBooks.filter(book => book.status === "READ").length;
  const selectedAuthorMissing = selectedAuthorBooks.length - selectedAuthorOwned;
  const selectedAuthorNew = selectedAuthorBooks.filter(book => book.newlyDiscovered).length;

  const filteredLibrary = useMemo(() => {
    const needle = libraryQuery.trim().toLocaleLowerCase("fr");
    const books = library.filter(book => {
      const matchesFilter =
        libraryFilter === "ALL" ||
        (libraryFilter === "FAVORITES" ? book.favorite :
          libraryFilter === "OWNED" ? book.owned :
          libraryFilter === "MISSING" ? !book.owned :
          book.status === libraryFilter);

      if (!matchesFilter) return false;
      if (!needle) return true;

      const haystack = [
        book.title,
        ...book.authors,
        book.isbn10 ?? "",
        book.isbn13 ?? "",
        book.publisher ?? ""
      ].join(" ").toLocaleLowerCase("fr");

      return haystack.includes(needle);
    });

    return [...books].sort((a, b) => {
      if (librarySort === "TITLE") return a.title.localeCompare(b.title, "fr");
      if (librarySort === "AUTHOR") return authorSortKey(primaryAuthor(a)).localeCompare(authorSortKey(primaryAuthor(b)), "fr");
      if (librarySort === "PROGRESS") return progressPercent(b) - progressPercent(a);
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  }, [library, libraryFilter, libraryQuery, librarySort]);

  const groupedLibrary = useMemo(() => {
    const byAuthor = new Map<string, { author: string; books: LibraryBook[] }>();
    for (const book of filteredLibrary) {
      const author = primaryAuthor(book);
      const key = canonicalAuthorIdentity(author);
      const current = byAuthor.get(key);
      if (current) current.books.push(book);
      else byAuthor.set(key, { author, books: [book] });
    }

    return [...byAuthor.values()]
      .sort((a, b) => authorSortKey(a.author).localeCompare(authorSortKey(b.author), "fr"))
      .map(group => ({
        ...group,
        initial: authorInitial(group.author),
        anchor: `author-${normalizeText(group.author).replace(/\s+/g, "-") || "unknown"}`,
        books: [...group.books].sort((a, b) => {
          if (librarySort === "PROGRESS") return progressPercent(b) - progressPercent(a);
          if (librarySort === "RECENT") return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
          return a.title.localeCompare(b.title, "fr");
        }),
        ownedCount: group.books.filter(book => book.owned).length
      }));
  }, [filteredLibrary, librarySort]);

  const libraryInitials = useMemo(() => [...new Set(groupedLibrary.map(group => group.initial))], [groupedLibrary]);

  useEffect(() => {
    let active = true;
    initializeLibrary().then(
      books => { if (active) { setLibrary(books); setDbState("ready"); } },
      err => {
        if (active) {
          console.error("Tsundoku SQLite initialization failed:", err);
          setDbError(err instanceof Error ? err.message : String(err));
          setDbState("error");
        }
      }
    );
    return () => { active = false; };
  }, []);

  useEffect(() => {
    void hasGoogleBooksApiKey().then(setGoogleKeyConfigured).catch(err => {
      console.error("Credential storage initialization failed:", err);
    });
  }, []);

  useEffect(() => {
    if (!selectedId) { setSessions([]); return; }
    let active = true;
    void getReadingSessions(selectedId).then(value => { if (active) setSessions(value); }).catch(err => {
      if (active) setError(err instanceof Error ? err.message : "Impossible de charger les sessions.");
    });
    return () => { active = false; };
  }, [selectedId]);

  useEffect(() => {
  if (!Capacitor.isNativePlatform()) return;

  const listener = CapacitorApp.addListener("backButton", () => {
    setView(current => {
      if (current === "detail") {
        setSelectedId(null);
        return selectedAuthorKey ? "author" : "library";
      }

      if (current === "author") return "add";

      if (current === "library" || current === "add" || current === "settings") {
        return "home";
      }

      void CapacitorApp.exitApp();
      return current;
    });
  });

  return () => {
    void listener.then(handle => handle.remove());
  };
}, []);

  const isAdded = (b: BookSearchResult) => library.some(x =>
    (b.isbn13 && x.isbn13 === b.isbn13) ||
    (b.isbn10 && x.isbn10 === b.isbn10) ||
    (x.source === b.source && x.sourceId === b.sourceId));

  function enrichInBackground(found: BookSearchResult[], language: BookSearchLanguage) {
    void enrichSearchResults(found, language).then(enriched => {
      setResults(current => mergeSearchResults([...current, ...enriched]));
    }).catch(() => {
      // L'enrichissement (jaquettes/métadonnées) ne doit jamais bloquer la recherche.
    });
  }

  function enrichAuthorLibraryInBackground(found: BookSearchResult[], localBooks: LibraryBook[]) {
    void enrichSearchResults(found, preferredLanguage).then(async enriched => {
      const matches = enriched.flatMap(book => {
        if (!book.coverUrl && !book.description && !book.pageCount && !book.language) return [];
        const local = localBooks.find(candidate => isSameWork(book, candidate));
        if (!local) return [];
        return [{ id: local.id, book }];
      });
      if (!matches.length) return;
      const refreshed = await refreshLibraryMetadata(matches);
      setLibrary(refreshed);
    }).catch(() => {
      // Une jaquette manquante ne doit jamais empêcher l'utilisation de la bibliographie.
    });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const found = searchField === "author"
        ? await searchCompleteAuthorBibliography(q, provider, preferredLanguage)
        : await searchBooks(q, provider, preferredLanguage, 0, searchField);
      setResults(found);
      setShowOtherLanguages(false);
      setSearchOffset(40);
      setCanLoadMore(searchField !== "author" && found.length > 0);
      setActiveSearchLanguage(preferredLanguage);
      setLastSearchHadNoPreferredResults(preferredLanguage !== "all" && found.length === 0);
      enrichInBackground(found, preferredLanguage);
    }
    catch (x) { setError(x instanceof Error ? x.message : "Recherche impossible"); }
    finally { setBusy(false); }
  }

  async function add(book: BookSearchResult, owned = true) {
    setError("");
    try { setLibrary(await addBookToLibrary(book, owned)); }
    catch (x) { setError(x instanceof Error ? x.message : "Impossible d'ajouter le livre."); }
  }

  async function openAuthorBibliography(group: { key: string; name: string; books: BookSearchResult[] }) {
    if (dbState !== "ready" || busy) return;
    setBusy(true);
    setError("");
    try {
      // Une bibliographie suivie appartient à la bibliothèque locale : les œuvres
      // non cochées sont simplement des livres manquants (owned = false).
      const updated = await addBooksToLibrary(group.books, false);
      const refreshedAt = new Date().toISOString();
      await saveFollowedAuthor(group.key, group.name, refreshedAt);
      setLibrary(updated);
      enrichAuthorLibraryInBackground(group.books, updated);
      setSelectedAuthorKey(group.key);
      setSelectedAuthorName(group.name);
      setAuthorLastRefreshedAt(refreshedAt);
      setAuthorRefreshMessage("");
      setAuthorBookFilter("ALL");
      setAuthorBookSort("MISSING");
      setView("author");
    } catch (x) {
      setError(x instanceof Error ? x.message : "Impossible d'ajouter la bibliographie de cet auteur.");
    } finally {
      setBusy(false);
    }
  }

  async function quickPatchBook(book: LibraryBook, changes: Parameters<typeof updateLibraryBook>[1]) {
    try {
      setLibrary(await updateLibraryBook(book.id, changes));
    } catch (x) {
      setError(x instanceof Error ? x.message : "Modification impossible.");
    }
  }

  async function openLibraryAuthor(author: string) {
    const key = canonicalAuthorIdentity(author);
    const books = library.filter(book => canonicalAuthorIdentity(book.authors[0] ?? "") === key);
    setSelectedAuthorName(author);
    setSelectedAuthorKey(key);
    setAuthorBookFilter("ALL");
    setAuthorBookSort("MISSING");
    setAuthorRefreshMessage("");
    setView("author");
    enrichAuthorLibraryInBackground(books, books);
    try {
      const info = await getFollowedAuthor(key);
      setAuthorLastRefreshedAt(info?.lastRefreshedAt);
    } catch {
      setAuthorLastRefreshedAt(undefined);
    }
  }

  async function refreshSelectedAuthor() {
    if (!selectedAuthorKey || !selectedAuthorName || authorRefreshBusy) return;
    setAuthorRefreshBusy(true);
    setAuthorRefreshMessage("");
    setError("");
    try {
      const remoteRaw = await searchCompleteAuthorBibliography(selectedAuthorName, "all", preferredLanguage, true);
      const remote = collapseToWorks(remoteRaw.filter(book => {
        const key = canonicalAuthorIdentity(book.authors[0] ?? selectedAuthorName);
        return !key || key === selectedAuthorKey;
      }));

      const current = library.filter(book => canonicalAuthorIdentity(book.authors[0] ?? "") === selectedAuthorKey);
      const newBooks = remote.filter(book => !current.some(local => isSameWork(book, local)));

      let updated = current.some(book => book.newlyDiscovered)
        ? await clearNewlyDiscoveredBooks(current.map(book => book.id))
        : library;

      if (newBooks.length) updated = await addBooksToLibrary(newBooks, false, true);

      const refreshedAt = new Date().toISOString();
      await saveFollowedAuthor(selectedAuthorKey, selectedAuthorName, refreshedAt);
      setLibrary(updated);
      setAuthorLastRefreshedAt(refreshedAt);
      setAuthorRefreshMessage(newBooks.length
        ? `${newBooks.length} nouvelle${newBooks.length > 1 ? "s" : ""} œuvre${newBooks.length > 1 ? "s" : ""} détectée${newBooks.length > 1 ? "s" : ""}.`
        : "Bibliographie à jour : aucune nouvelle œuvre détectée.");
      if (newBooks.length) setAuthorBookFilter("ALL");
      enrichAuthorLibraryInBackground(remote, updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Impossible d’actualiser cette bibliographie.");
    } finally {
      setAuthorRefreshBusy(false);
    }
  }

  async function removeSelectedAuthor() {
    if (!selectedAuthorKey || authorDeleteBusy || selectedAuthorBooks.length === 0) return;
    const name = selectedAuthorName || "cet auteur";
    const confirmed = window.confirm(
      `Supprimer ${name} et toute sa bibliographie suivie de Tsundoku ?\n\n${selectedAuthorBooks.length} livre${selectedAuthorBooks.length > 1 ? "s" : ""} seront retirés de la bibliothèque locale, avec leurs statuts Possédé/Lu.`
    );
    if (!confirmed) return;

    setAuthorDeleteBusy(true);
    setError("");
    try {
      const next = await removeBooksFromLibrary(selectedAuthorBooks.map(book => book.id));
      await removeFollowedAuthor(selectedAuthorKey);
      setLibrary(next);
      setSelectedAuthorKey(null);
      setSelectedAuthorName("");
      setAuthorLastRefreshedAt(undefined);
      setAuthorRefreshMessage("");
      setAuthorBookFilter("ALL");
      setView("library");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Impossible de supprimer cet auteur.");
    } finally {
      setAuthorDeleteBusy(false);
    }
  }

  async function patch(changes: Parameters<typeof updateLibraryBook>[1]) {
    if (!selected) return;
    try { setLibrary(await updateLibraryBook(selected.id, changes)); }
    catch (x) { setError(x instanceof Error ? x.message : "Modification impossible."); }
  }

  async function saveReadingSession(e: FormEvent) {
    e.preventDefault();
    if (!selected || sessionBusy) return;
    setSessionBusy(true);
    setError("");
    try {
      const endProgress = sessionEndProgress.trim() === "" ? undefined : Number(sessionEndProgress);
      const result = await addReadingSession(selected.id, {
        startedAt: new Date(sessionDate).toISOString(),
        durationMinutes: sessionDuration,
        endProgress,
        notes: sessionNotes
      });
      setLibrary(result.library);
      setSessions(result.sessions);
      setSessionDate(localDateTimeValue());
      setSessionEndProgress("");
      setSessionNotes("");
    } catch (x) {
      setError(x instanceof Error ? x.message : "Impossible d'enregistrer la session.");
    } finally {
      setSessionBusy(false);
    }
  }

  async function removeSelectedBook() {
    if (!selected || deleteBusy) return;
    const confirmed = window.confirm(
      `Supprimer « ${selected.title} » de votre bibliothèque ?\n\nCette action retirera également son état de lecture et sa progression.`
    );
    if (!confirmed) return;

    setDeleteBusy(true);
    setError("");
    try {
      setLibrary(await removeBookFromLibrary(selected.id));
      setSelectedId(null);
      setView("library");
    } catch (x) {
      setError(x instanceof Error ? x.message : "Suppression impossible.");
    } finally {
      setDeleteBusy(false);
    }
  }

  async function saveGoogleKey(e: FormEvent) {
    e.preventDefault();
    setCredentialBusy(true);
    setCredentialMessage("");
    try {
      await saveGoogleBooksApiKey(googleKey);
      setGoogleKey("");
      setGoogleKeyConfigured(true);
      setCredentialMessage("Clé Google Books enregistrée.");
    } catch (x) {
      setCredentialMessage(x instanceof Error ? x.message : "Impossible d'enregistrer la clé.");
    } finally {
      setCredentialBusy(false);
    }
  }

  async function removeGoogleKey() {
    setCredentialBusy(true);
    setCredentialMessage("");
    try {
      await deleteGoogleBooksApiKey();
      setGoogleKey("");
      setGoogleKeyConfigured(false);
      setCredentialMessage("Clé Google Books supprimée.");
    } catch (x) {
      setCredentialMessage(x instanceof Error ? x.message : "Impossible de supprimer la clé.");
    } finally {
      setCredentialBusy(false);
    }
  }

  async function searchAllLanguages() {
    setBusy(true);
    setError("");
    try {
      const found = searchField === "author"
        ? await searchCompleteAuthorBibliography(q, provider, "all")
        : await searchBooks(q, provider, "all", 0, searchField);
      setResults(found);
      setShowOtherLanguages(true);
      setSearchOffset(40);
      setCanLoadMore(searchField !== "author" && found.length > 0);
      setActiveSearchLanguage("all");
      setLastSearchHadNoPreferredResults(false);
      enrichInBackground(found, "all");
    } catch (x) {
      setError(x instanceof Error ? x.message : "Recherche impossible");
    } finally {
      setBusy(false);
    }
  }

  async function loadMoreResults() {
    if (busy || !canLoadMore) return;
    setBusy(true);
    setError("");
    try {
      const found = await searchBooks(q, provider, activeSearchLanguage, searchOffset, searchField);
      setResults(current => mergeSearchResults([...current, ...found]));
      setSearchOffset(current => current + 40);
      setCanLoadMore(found.length > 0);
      enrichInBackground(found, activeSearchLanguage);
    } catch (x) {
      setError(x instanceof Error ? x.message : "Recherche impossible");
    } finally {
      setBusy(false);
    }
  }

  function changePreferredLanguage(language: BookSearchLanguage) {
    setPreferredLanguageState(language);
    setPreferredBookLanguage(language);
    setCredentialMessage("Langue préférée enregistrée.");
  }

  function openBook(b: LibraryBook) {
    setSelectedId(b.id);
    setView("detail");
  }

  const filterButtons: Array<[LibraryFilter, string, number]> = [
    ["ALL", "Tous", library.length],
    ["MISSING", "Manquants", library.filter(book => !book.owned).length],
    ["OWNED", "Possédés", library.filter(book => book.owned).length],
    ["TO_READ", "À lire", countStatus(library, "TO_READ")],
    ["READING", "En cours", countStatus(library, "READING")],
    ["READ", "Lus", countStatus(library, "READ")],
    ["ON_HOLD", "En pause", countStatus(library, "ON_HOLD")],
    ["ABANDONED", "Abandonnés", countStatus(library, "ABANDONED")],
    ["FAVORITES", "★ Favoris", library.filter(book => book.favorite).length]
  ];

  return <div className="shell">
    <aside>
      <div className="brand">T <b>Tsundoku</b></div>
      <nav>
        <button onClick={() => setView("home")}>Accueil</button>
        <button onClick={() => setView("library")}>Bibliothèque</button>
        <button onClick={() => setView("add")}>Ajouter</button>
        <button onClick={() => setView("settings")}>Paramètres</button>
      </nav>
      <span>{dbState === "loading" && "◌ Initialisation SQLite…"}{dbState === "ready" && "● SQLite local"}{dbState === "error" && "⚠ SQLite indisponible"}</span>
    </aside>

    <main>
      <header>Tsundoku V2<h1>{view === "home" ? "Bonjour 👋" : view === "library" ? "Ma bibliothèque" : view === "add" ? "Rechercher" : view === "author" ? selectedAuthorName || "Bibliographie" : view === "settings" ? "Paramètres" : selected?.title ?? "Livre"}</h1></header>

      {dbState === "error" && <section className="hero"><h2>SQLite n'a pas pu démarrer</h2><p className="error">{dbError}</p></section>}

      {view === "home" && <>
        <section className="hero">
          <h2>Ta bibliothèque, disponible partout.</h2>
          <p>Parce que chaque livre mérite d'être lu.</p>
          <button disabled={dbState !== "ready"} onClick={() => setView("add")}>Ajouter un livre</button>
        </section>
        <section className="stats">
          <button onClick={() => { setLibraryFilter("ALL"); setView("library"); }}><strong>{library.length}</strong><span>Livres</span></button>
          <button onClick={() => { setLibraryFilter("READING"); setView("library"); }}><strong>{countStatus(library, "READING")}</strong><span>En cours</span></button>
          <button onClick={() => { setLibraryFilter("TO_READ"); setView("library"); }}><strong>{countStatus(library, "TO_READ")}</strong><span>À lire</span></button>
          <button onClick={() => { setLibraryFilter("READ"); setView("library"); }}><strong>{countStatus(library, "READ")}</strong><span>Lus</span></button>
        </section>
      </>}

      {view === "library" && <>
        <section className="library-toolbar">
          <div className="library-search">
            <input value={libraryQuery} onChange={e => setLibraryQuery(e.target.value)} placeholder="Rechercher dans ma bibliothèque…" />
            <select value={librarySort} onChange={e => setLibrarySort(e.target.value as LibrarySort)}>
              <option value="RECENT">Modifiés récemment</option>
              <option value="TITLE">Titre</option>
              <option value="AUTHOR">Auteur</option>
              <option value="PROGRESS">Progression</option>
            </select>
          </div>
          <div className="filter-row">
            {filterButtons.map(([value, label, count]) =>
              <button key={value} className={libraryFilter === value ? "filter active" : "filter"} onClick={() => setLibraryFilter(value)}>
                {label} <span>{count}</span>
              </button>
            )}
          </div>
        </section>

        <div className="library-summary">
          <h2>{filteredLibrary.length} livre{filteredLibrary.length > 1 ? "s" : ""}</h2>
          {(libraryQuery || libraryFilter !== "ALL") && <button className="text-button" onClick={() => { setLibraryQuery(""); setLibraryFilter("ALL"); }}>Effacer les filtres</button>}
        </div>

        {filteredLibrary.length > 0 ? <>
          <nav className="alphabet-strip" aria-label="Accès rapide par auteur">
            {"ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map(letter => libraryInitials.includes(letter)
              ? <a key={letter} href={`#letter-${letter}`}>{letter}</a>
              : <span key={letter}>{letter}</span>)}
            {libraryInitials.includes("#") && <a href="#letter-other">#</a>}
          </nav>
          <div className="author-library">
            {groupedLibrary.map((group, index) => {
              const previousInitial = index > 0 ? groupedLibrary[index - 1]?.initial : undefined;
              const showLetter = group.initial !== previousInitial;
              const letterId = group.initial === "#" ? "letter-other" : `letter-${group.initial}`;
              return <section className="author-section" id={group.anchor} key={group.anchor}>
                {showLetter && <div className="author-letter-anchor" id={letterId}>{group.initial}</div>}
                <div className="author-heading">
                  <button type="button" className="author-open" onClick={() => void openLibraryAuthor(group.author)}><p className="eyebrow">Auteur</p><h2>{group.author}</h2></button>
                  <div className="author-count"><strong>{group.ownedCount}/{group.books.length}</strong><span>possédé{group.ownedCount > 1 ? "s" : ""}</span><em>{group.books.length - group.ownedCount} manquant{group.books.length - group.ownedCount > 1 ? "s" : ""}</em></div>
                </div>
                <div className="grid">{group.books.map(b => <LibraryCard key={b.id} b={b} onOpen={openBook} />)}</div>
              </section>;
            })}
          </div>
        </>
          : <section className="empty-state"><div>📚</div><h2>Aucun livre trouvé</h2><p>Essaie un autre filtre ou une autre recherche.</p><button onClick={() => { setLibraryQuery(""); setLibraryFilter("ALL"); }}>Voir toute la bibliothèque</button></section>}
      </>}

      {view === "author" && <>
        <section className="author-bibliography-header">
          <div className="author-header-main">
            <div>
              <button type="button" className="text-button" onClick={() => setView("library")}>← Bibliothèque</button>
              <p className="eyebrow">Bibliographie suivie</p>
              <h2>{selectedAuthorName}</h2>
              <p>{selectedAuthorBooks.length} œuvre{selectedAuthorBooks.length > 1 ? "s" : ""}</p>
              <div className="author-stat-grid" aria-label="Résumé de la bibliographie">
                <button type="button" className="author-stat missing" onClick={() => setAuthorBookFilter("MISSING")}><strong>{selectedAuthorMissing}</strong><span>Manquant{selectedAuthorMissing > 1 ? "s" : ""}</span></button>
                <button type="button" className="author-stat owned" onClick={() => setAuthorBookFilter("OWNED")}><strong>{selectedAuthorOwned}</strong><span>Possédé{selectedAuthorOwned > 1 ? "s" : ""}</span></button>
                <button type="button" className="author-stat read" onClick={() => setAuthorBookFilter("READ")}><strong>{selectedAuthorRead}</strong><span>Lu{selectedAuthorRead > 1 ? "s" : ""}</span></button>
              </div>
            </div>
            <div className="author-header-actions">
              <div className="author-refresh-status">
                <small>Dernière actualisation</small>
                <strong>{formatRefreshDate(authorLastRefreshedAt)}</strong>
                {selectedAuthorNew > 0 && <span className="new-count">{selectedAuthorNew} nouveauté{selectedAuthorNew > 1 ? "s" : ""}</span>}
              </div>
              <button type="button" className="refresh-author-button" disabled={authorRefreshBusy} onClick={() => void refreshSelectedAuthor()}>
                {authorRefreshBusy ? "Actualisation…" : "↻ Actualiser la bibliographie"}
              </button>
              <button type="button" className="danger-button author-delete-button" disabled={authorDeleteBusy} onClick={() => void removeSelectedAuthor()}>
                {authorDeleteBusy ? "Suppression…" : "Supprimer l’auteur"}
              </button>
            </div>
          </div>
          {authorRefreshMessage && <p className="author-refresh-message">{authorRefreshMessage}</p>}
          <p className="author-delete-help">Retire cet auteur et toute sa bibliographie suivie de Tsundoku. Une confirmation sera demandée.</p>
        </section>

        <section className="author-toolbar">
          <div className="filter-row author-filters">
            <button className={authorBookFilter === "ALL" ? "filter active" : "filter"} onClick={() => setAuthorBookFilter("ALL")}>Tous <span>{selectedAuthorBooks.length}</span></button>
            <button className={authorBookFilter === "MISSING" ? "filter active missing-filter" : "filter missing-filter"} onClick={() => setAuthorBookFilter("MISSING")}>Manquants <span>{selectedAuthorMissing}</span></button>
            <button className={authorBookFilter === "OWNED" ? "filter active" : "filter"} onClick={() => setAuthorBookFilter("OWNED")}>Possédés <span>{selectedAuthorOwned}</span></button>
            <button className={authorBookFilter === "READ" ? "filter active" : "filter"} onClick={() => setAuthorBookFilter("READ")}>Lus <span>{selectedAuthorRead}</span></button>
            <button className={authorBookFilter === "TO_READ" ? "filter active" : "filter"} onClick={() => setAuthorBookFilter("TO_READ")}>Non lus <span>{selectedAuthorBooks.length - selectedAuthorRead}</span></button>
          </div>
          <select value={authorBookSort} onChange={e => setAuthorBookSort(e.target.value as AuthorBookSort)}>
            <option value="MISSING">Manquants d’abord</option>
            <option value="TITLE">Titre</option>
            <option value="DATE">Parution récente</option>
          </select>
        </section>

        <div className="author-book-list author-book-list-flat">
          {visibleAuthorBooks.map(book => <article className={`author-book-row ${book.owned ? "owned" : "missing"}`} key={book.id}>
            <button type="button" className="book-row-main" onClick={() => openBook(book)}>
              {book.coverUrl ? <img src={book.coverUrl} alt="" /> : <div className="mini-cover">📖</div>}
              <span><small>{book.publishedYear ?? "Date inconnue"} {book.newlyDiscovered && <b className="new-book-badge">Nouveau</b>}</small><strong>{book.title}</strong><em>{book.publisher ?? ""}</em></span>
            </button>
            <div className="quick-book-actions">
              <button type="button" className={book.owned ? "state-toggle active-owned" : "state-toggle"} onClick={() => void quickPatchBook(book, { owned: !book.owned })}>{book.owned ? "✓ Possédé" : "✗ Manquant"}</button>
              <button type="button" className={book.status === "READ" ? "state-toggle active-read" : "state-toggle"} onClick={() => void quickPatchBook(book, { status: book.status === "READ" ? "TO_READ" : "READ" })}>{book.status === "READ" ? "✓ Lu" : "○ Non lu"}</button>
            </div>
          </article>)}
        </div>
        {visibleAuthorBooks.length === 0 && <section className="empty-state"><div>📚</div><h2>Aucun livre dans ce filtre</h2><p>Choisis un autre filtre pour voir la bibliographie.</p></section>}
      </>}

      {view === "add" && <>
        <form className="search-form" onSubmit={submit}>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Titre, auteur ou ISBN…" />
          <select value={searchField} onChange={e => setSearchField(e.target.value as BookSearchField)}>
            <option value="all">Recherche générale</option><option value="author">Auteur</option><option value="title">Titre</option><option value="isbn">ISBN</option>
          </select>
          <select value={provider} onChange={e => setProvider(e.target.value as SearchProvider)}>
            <option value="all">Toutes les sources</option><option value="bnf">BnF</option><option value="open-library">Open Library</option><option value="google-books">Google Books</option>
          </select>
          <button disabled={busy}>{busy ? "Recherche…" : "Rechercher"}</button>
        </form>
        {error && <p className="error">{error}</p>}
        {lastSearchHadNoPreferredResults && <section className="search-fallback"><p>Aucun résultat dans la langue préférée.</p><button type="button" onClick={() => void searchAllLanguages()}>Afficher toutes les langues</button></section>}
        {searchField === "author" && results.length > 0 ? <>
          <section className="author-search-summary">
            <div><p className="eyebrow">Résultats auteurs</p><h2>Choisis l’auteur à suivre</h2></div>
            <p>En ouvrant un auteur, sa bibliographie est enregistrée localement. Tu peux ensuite marquer les livres possédés ou lus directement dans la liste.</p>
          </section>
          <div className="author-result-list">
            {authorSearchGroups.map(group => {
              const owned = group.books.filter(book => library.some(local => local.owned && isSameWork(book, local))).length;
              return <article className="author-result" key={group.key}>
                <div>
                  <p className="eyebrow">Auteur</p>
                  <h2>{group.name}</h2>
                  <p><strong>{group.books.length}</strong> œuvre{group.books.length > 1 ? "s" : ""} trouvée{group.books.length > 1 ? "s" : ""} · {owned} possédée{owned > 1 ? "s" : ""}</p>
                </div>
                <button type="button" disabled={busy || dbState !== "ready"} onClick={() => void openAuthorBibliography(group)}>Ouvrir la bibliographie</button>
              </article>;
            })}
          </div>
          {activeSearchLanguage !== "all" && results.some(book => getBookLanguageGroup(book, activeSearchLanguage) !== "preferred") && <div className="load-more"><button type="button" onClick={() => void searchAllLanguages()}>Voir aussi les autres langues</button></div>}
        </> : (() => {
          const visible = activeSearchLanguage === "all" || showOtherLanguages ? results : results.filter(book => getBookLanguageGroup(book, activeSearchLanguage) === "preferred");
          const hiddenCount = results.length - visible.length;
          return <>
            <div className="grid">{visible.map(b => <SearchCard key={`${b.source}-${b.sourceId}`} b={b} added={isAdded(b)} onAdd={dbState === "ready" ? book => void add(book, true) : undefined} onTrack={dbState === "ready" ? book => void add(book, false) : undefined} />)}</div>
            {hiddenCount > 0 && <div className="load-more"><button type="button" onClick={() => setShowOtherLanguages(true)}>Afficher les autres langues / indéterminées ({hiddenCount})</button></div>}
          </>;
        })()}
        {searchField !== "author" && results.length > 0 && canLoadMore && <div className="load-more"><button type="button" disabled={busy} onClick={() => void loadMoreResults()}>{busy ? "Chargement…" : "Charger plus"}</button></div>}
      </>}

      {view === "settings" && <section className="settings-card">
        <div className="settings-section">
          <p className="eyebrow">Recherche de livres</p>
          <h2>Langue préférée</h2>
          <p className="settings-help">La langue sert à classer les résultats, pas à les supprimer. En français, Tsundoku combine la BnF, Open Library et Google Books.</p>
          <label className="language-setting">Langue des résultats
            <select value={preferredLanguage} onChange={e => changePreferredLanguage(e.target.value as BookSearchLanguage)}>
              <option value="fr">Français</option>
              <option value="en">Anglais</option>
              <option value="de">Allemand</option>
              <option value="es">Espagnol</option>
              <option value="it">Italien</option>
              <option value="all">Toutes les langues</option>
            </select>
          </label>
        </div>
        <div className="settings-section settings-divider">
        <div className="settings-heading">
          <div>
            <p className="eyebrow">Sources de livres</p>
            <h2>Google Books</h2>
          </div>
          <span className={googleKeyConfigured ? "credential-status configured" : "credential-status"}>
            {googleKeyConfigured ? "● Clé configurée" : "○ Aucune clé"}
          </span>
        </div>
        <p className="settings-help">
          La clé est propre à cet appareil. Elle n'est enregistrée ni dans SQLite, ni dans les données synchronisables.
          Sur Android, elle est conservée dans le stockage sécurisé du système.
        </p>
        <form className="credential-form" onSubmit={saveGoogleKey}>
          <label>
            {googleKeyConfigured ? "Remplacer la clé API" : "Clé API Google Books"}
            <input
              type="password"
              autoComplete="off"
              value={googleKey}
              onChange={e => setGoogleKey(e.target.value)}
              placeholder={googleKeyConfigured ? "Saisir une nouvelle clé…" : "Saisir la clé…"}
            />
          </label>
          <div className="credential-actions">
            <button disabled={credentialBusy || !googleKey.trim()}>
              {credentialBusy ? "Enregistrement…" : googleKeyConfigured ? "Remplacer" : "Enregistrer"}
            </button>
            {googleKeyConfigured && <button type="button" className="danger-button" disabled={credentialBusy} onClick={() => void removeGoogleKey()}>Supprimer la clé</button>}
          </div>
        </form>
        {credentialMessage && <p className="credential-message">{credentialMessage}</p>}
        </div>
      </section>}

      {view === "detail" && selected && <section className="book-detail">
        <button className="secondary" onClick={() => setView("library")}>← Bibliothèque</button>
        <div className="detail-layout">
          <div>{selected.coverUrl ? <img className="detail-cover" src={selected.coverUrl} alt="" /> : <div className="detail-cover cover">📖</div>}</div>
          <div>
            <p className="eyebrow">{displayAuthors(selected.authors)}</p><h2>{selected.title}</h2>
            <p>{selected.description || "Aucune description disponible."}</p>
            <div className="detail-grid">
              <label>Statut<select value={selected.status} onChange={e => patch({ status: e.target.value as ReadingStatus })}>
                {Object.entries(statusLabels).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select></label>
              <label className="check"><input type="checkbox" checked={selected.favorite} onChange={e => patch({ favorite: e.target.checked })} /> Favori ★</label>
              <label className="check"><input type="checkbox" checked={selected.owned} onChange={e => patch({ owned: e.target.checked })} /> Je possède ce livre</label>
              <label>Progression<input type="number" min="0" value={selected.progressValue ?? ""} onChange={e => patch({ progressValue: e.target.value === "" ? 0 : Number(e.target.value) })} /></label>
              <label>Total<input type="number" min="0" value={selected.progressTotal ?? ""} onChange={e => patch({ progressTotal: e.target.value === "" ? 0 : Number(e.target.value) })} /></label>
            </div>
            <p className="meta">{selected.publisher || "Éditeur inconnu"} {selected.publishedYear ? `· ${selected.publishedYear}` : ""} {selected.isbn13 ? `· ISBN ${selected.isbn13}` : ""}</p>
            <section className="reading-sessions">
              <div className="session-heading">
                <div><p className="eyebrow">Journal de lecture</p><h3>Sessions de lecture</h3></div>
                <strong>{sessions.reduce((sum, session) => sum + session.durationMinutes, 0)} min</strong>
              </div>
              <form className="session-form" onSubmit={saveReadingSession}>
                <label>Date et heure<input type="datetime-local" required value={sessionDate} onChange={e => setSessionDate(e.target.value)} /></label>
                <label>Durée (min)<input type="number" min="1" required value={sessionDuration} onChange={e => setSessionDuration(Number(e.target.value))} /></label>
                <label>Page / progression après la session<input type="number" min="0" max={selected.progressTotal} placeholder={selected.progressValue != null ? String(selected.progressValue) : "Optionnel"} value={sessionEndProgress} onChange={e => setSessionEndProgress(e.target.value)} /></label>
                <label className="session-notes">Notes<input type="text" placeholder="Optionnel" value={sessionNotes} onChange={e => setSessionNotes(e.target.value)} /></label>
                <button disabled={sessionBusy}>{sessionBusy ? "Enregistrement…" : "Enregistrer la session"}</button>
              </form>
              {sessions.length > 0 ? <div className="session-list">
                {sessions.map(session => <article key={session.id}>
                  <div><strong>{formatSessionDate(session.startedAt)}</strong><small>{session.durationMinutes} min{session.endProgress != null ? ` · progression ${session.endProgress}${selected.progressTotal ? `/${selected.progressTotal}` : ""}` : ""}</small></div>
                  {session.notes && <p>{session.notes}</p>}
                </article>)}
              </div> : <p className="meta">Aucune session enregistrée pour ce livre.</p>}
            </section>
            <div className="danger-zone">
              <div>
                <strong>Supprimer de ma bibliothèque</strong>
                <p>Retire ce livre, son statut et sa progression de ta bibliothèque.</p>
              </div>
              <button type="button" className="danger-button" disabled={deleteBusy} onClick={() => void removeSelectedBook()}>
                {deleteBusy ? "Suppression…" : "Supprimer"}
              </button>
            </div>
          </div>
        </div>
      </section>}
    </main>
  </div>;
}
