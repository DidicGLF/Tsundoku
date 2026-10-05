import { useEffect, useState, type FormEvent } from "react";
import type { BookSearchResult } from "@tsundoku/book-sources";
import { searchBooks, type SearchProvider } from "./services/bookSearch";
import {
  addBookToLibrary,
  initializeLibrary,
  type LibraryBook
} from "./services/library";
import "./styles.css";

function Card({
  b,
  onAdd,
  added
}: {
  b: BookSearchResult;
  onAdd?: (b: BookSearchResult) => void;
  added?: boolean;
}) {
  return (
    <article className="card">
      {b.coverUrl ? <img src={b.coverUrl} alt="" /> : <div className="cover">📖</div>}
      <div>
        <small>{b.source === "google-books" ? "Google Books" : "Open Library"}</small>
        <h3>{b.title}</h3>
        <p>{b.authors.join(", ") || "Auteur inconnu"}</p>
        {onAdd && (
          <button disabled={added} onClick={() => onAdd(b)}>
            {added ? "Ajouté" : "Ajouter"}
          </button>
        )}
      </div>
    </article>
  );
}

export default function App() {
  const [view, setView] = useState<"home" | "library" | "add">("home");
  const [library, setLibrary] = useState<LibraryBook[]>([]);
  const [dbState, setDbState] = useState<"loading" | "ready" | "error">("loading");
  const [dbError, setDbError] = useState("");
  const [q, setQ] = useState("");
  const [provider, setProvider] = useState<SearchProvider>("open-library");
  const [results, setResults] = useState<BookSearchResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    initializeLibrary().then(
      books => {
        if (!active) return;
        setLibrary(books);
        setDbState("ready");
      },
      err => {
        if (!active) return;
        console.error("Tsundoku SQLite initialization failed:", err);
        setDbError(err instanceof Error ? err.message : String(err));
        setDbState("error");
      }
    );

    return () => {
      active = false;
    };
  }, []);

  const isAdded = (b: BookSearchResult) =>
    library.some(
      x =>
        (b.isbn13 && x.isbn13 === b.isbn13) ||
        (b.isbn10 && x.isbn10 === b.isbn10) ||
        (x.source === b.source && x.sourceId === b.sourceId)
    );

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      setResults(await searchBooks(q, provider));
    } catch (x) {
      setError(x instanceof Error ? x.message : "Recherche impossible");
    } finally {
      setBusy(false);
    }
  }

  async function add(book: BookSearchResult) {
    setError("");
    try {
      setLibrary(await addBookToLibrary(book));
    } catch (x) {
      const message = x instanceof Error ? x.message : "Impossible d'ajouter le livre.";
      console.error("Tsundoku SQLite write failed:", x);
      setError(message);
    }
  }

  return (
    <div className="shell">
      <aside>
        <div className="brand">T <b>Tsundoku</b></div>
        <nav>
          <button onClick={() => setView("home")}>Accueil</button>
          <button onClick={() => setView("library")}>Bibliothèque</button>
          <button onClick={() => setView("add")}>Ajouter</button>
        </nav>

        <span>
          {dbState === "loading" && "◌ Initialisation SQLite…"}
          {dbState === "ready" && "● SQLite local"}
          {dbState === "error" && "⚠ SQLite indisponible"}
        </span>
      </aside>

      <main>
        <header>
          Tsundoku V2
          <h1>
            {view === "home"
              ? "Bonjour 👋"
              : view === "library"
                ? "Ma bibliothèque"
                : "Ajouter un livre"}
          </h1>
        </header>

        {dbState === "error" && (
          <section className="hero">
            <h2>SQLite n'a pas pu démarrer</h2>
            <p className="error">{dbError}</p>
            <p>Recharge la page après correction. L'erreur complète est aussi disponible dans la console du navigateur.</p>
          </section>
        )}

        {view === "home" && (
          <>
            <section className="hero">
              <h2>Ta bibliothèque, disponible partout.</h2>
              <p>Parce que chaque livre mérite d'être lu.</p>
              <button disabled={dbState !== "ready"} onClick={() => setView("add")}>
                Ajouter un livre
              </button>
            </section>
            <h2>Mes livres ({library.length})</h2>
          </>
        )}

        {view === "library" && (
          <>
            <h2>{library.length} livre{library.length > 1 ? "s" : ""}</h2>
            <div className="grid">
              {library.map(b => <Card key={b.id} b={b} />)}
            </div>
          </>
        )}

        {view === "add" && (
          <>
            <form onSubmit={submit}>
              <input
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="Titre, auteur ou ISBN…"
              />
              <select
                value={provider}
                onChange={e => setProvider(e.target.value as SearchProvider)}
              >
                <option value="open-library">Open Library</option>
                <option value="google-books">Google Books</option>
                <option value="all">Toutes les sources</option>
              </select>
              <button disabled={busy}>{busy ? "Recherche…" : "Rechercher"}</button>
            </form>

            {error && <p className="error">{error}</p>}

            <div className="grid">
              {results.map(b => (
                <Card
                  key={`${b.source}-${b.sourceId}`}
                  b={b}
                  added={isAdded(b)}
                  onAdd={dbState === "ready" ? add : undefined}
                />
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
