import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Capacitor } from "@capacitor/core";
import { App as CapacitorApp } from "@capacitor/app";
import type { BookSearchResult } from "@tsundoku/book-sources";
import type { ReadingStatus } from "@tsundoku/database";
import { searchBooks, type SearchProvider } from "./services/bookSearch";
import {
  addBookToLibrary,
  initializeLibrary,
  updateLibraryBook,
  type LibraryBook
} from "./services/library";
import "./styles.css";

const statusLabels: Record<ReadingStatus, string> = {
  TO_READ: "À lire",
  READING: "En cours",
  READ: "Lu",
  ON_HOLD: "En pause",
  ABANDONED: "Abandonné"
};

type LibraryFilter = "ALL" | ReadingStatus | "FAVORITES";
type LibrarySort = "RECENT" | "TITLE" | "AUTHOR" | "PROGRESS";

function SearchCard({ b, onAdd, added }: {
  b: BookSearchResult; onAdd?: (b: BookSearchResult) => void; added?: boolean;
}) {
  return <article className="card">
    {b.coverUrl ? <img src={b.coverUrl} alt="" /> : <div className="cover">📖</div>}
    <div>
      <small>{b.source === "google-books" ? "Google Books" : "Open Library"}</small>
      <h3>{b.title}</h3>
      <p>{b.authors.join(", ") || "Auteur inconnu"}</p>
      {onAdd && <button disabled={added} onClick={() => onAdd(b)}>{added ? "Ajouté" : "Ajouter"}</button>}
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
      <small>{statusLabels[b.status]} {b.favorite ? "★" : ""}</small>
      <h3>{b.title}</h3>
      <p>{b.authors.join(", ") || "Auteur inconnu"}</p>
      {progress != null && <div className="progress"><i style={{ width: `${progress}%` }} /></div>}
      {progress != null && <p>{progress}% · {b.progressValue}/{b.progressTotal}</p>}
    </div>
  </article>;
}

function countStatus(library: LibraryBook[], status: ReadingStatus) {
  return library.filter(book => book.status === status).length;
}

function progressPercent(book: LibraryBook) {
  if (!book.progressTotal || book.progressValue == null) return -1;
  return Math.min(100, (book.progressValue / book.progressTotal) * 100);
}

export default function App() {
  const [view, setView] = useState<"home" | "library" | "add" | "detail">("home");
  const [library, setLibrary] = useState<LibraryBook[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dbState, setDbState] = useState<"loading" | "ready" | "error">("loading");
  const [dbError, setDbError] = useState("");
  const [q, setQ] = useState("");
  const [provider, setProvider] = useState<SearchProvider>("open-library");
  const [results, setResults] = useState<BookSearchResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [libraryQuery, setLibraryQuery] = useState("");
  const [libraryFilter, setLibraryFilter] = useState<LibraryFilter>("ALL");
  const [librarySort, setLibrarySort] = useState<LibrarySort>("RECENT");

  const selected = library.find(b => b.id === selectedId);

  const filteredLibrary = useMemo(() => {
    const needle = libraryQuery.trim().toLocaleLowerCase("fr");
    const books = library.filter(book => {
      const matchesFilter =
        libraryFilter === "ALL" ||
        (libraryFilter === "FAVORITES" ? book.favorite : book.status === libraryFilter);

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
      if (librarySort === "AUTHOR") return (a.authors[0] ?? "").localeCompare(b.authors[0] ?? "", "fr");
      if (librarySort === "PROGRESS") return progressPercent(b) - progressPercent(a);
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  }, [library, libraryFilter, libraryQuery, librarySort]);

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
  if (!Capacitor.isNativePlatform()) return;

  const listener = CapacitorApp.addListener("backButton", () => {
    setView(current => {
      if (current === "detail") {
        setSelectedId(null);
        return "library";
      }

      if (current === "library" || current === "add") {
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

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try { setResults(await searchBooks(q, provider)); }
    catch (x) { setError(x instanceof Error ? x.message : "Recherche impossible"); }
    finally { setBusy(false); }
  }

  async function add(book: BookSearchResult) {
    setError("");
    try { setLibrary(await addBookToLibrary(book)); }
    catch (x) { setError(x instanceof Error ? x.message : "Impossible d'ajouter le livre."); }
  }

  async function patch(changes: Parameters<typeof updateLibraryBook>[1]) {
    if (!selected) return;
    try { setLibrary(await updateLibraryBook(selected.id, changes)); }
    catch (x) { setError(x instanceof Error ? x.message : "Modification impossible."); }
  }

  function openBook(b: LibraryBook) {
    setSelectedId(b.id);
    setView("detail");
  }

  const filterButtons: Array<[LibraryFilter, string, number]> = [
    ["ALL", "Tous", library.length],
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
      </nav>
      <span>{dbState === "loading" && "◌ Initialisation SQLite…"}{dbState === "ready" && "● SQLite local"}{dbState === "error" && "⚠ SQLite indisponible"}</span>
    </aside>

    <main>
      <header>Tsundoku V2<h1>{view === "home" ? "Bonjour 👋" : view === "library" ? "Ma bibliothèque" : view === "add" ? "Ajouter un livre" : selected?.title ?? "Livre"}</h1></header>

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

        {filteredLibrary.length > 0
          ? <div className="grid">{filteredLibrary.map(b => <LibraryCard key={b.id} b={b} onOpen={openBook} />)}</div>
          : <section className="empty-state"><div>📚</div><h2>Aucun livre trouvé</h2><p>Essaie un autre filtre ou une autre recherche.</p><button onClick={() => { setLibraryQuery(""); setLibraryFilter("ALL"); }}>Voir toute la bibliothèque</button></section>}
      </>}

      {view === "add" && <>
        <form className="search-form" onSubmit={submit}>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Titre, auteur ou ISBN…" />
          <select value={provider} onChange={e => setProvider(e.target.value as SearchProvider)}>
            <option value="open-library">Open Library</option><option value="google-books">Google Books</option><option value="all">Toutes les sources</option>
          </select>
          <button disabled={busy}>{busy ? "Recherche…" : "Rechercher"}</button>
        </form>
        {error && <p className="error">{error}</p>}
        <div className="grid">{results.map(b => <SearchCard key={`${b.source}-${b.sourceId}`} b={b} added={isAdded(b)} onAdd={dbState === "ready" ? add : undefined} />)}</div>
      </>}

      {view === "detail" && selected && <section className="book-detail">
        <button className="secondary" onClick={() => setView("library")}>← Bibliothèque</button>
        <div className="detail-layout">
          <div>{selected.coverUrl ? <img className="detail-cover" src={selected.coverUrl} alt="" /> : <div className="detail-cover cover">📖</div>}</div>
          <div>
            <p className="eyebrow">{selected.authors.join(", ") || "Auteur inconnu"}</p><h2>{selected.title}</h2>
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
          </div>
        </div>
      </section>}
    </main>
  </div>;
}
