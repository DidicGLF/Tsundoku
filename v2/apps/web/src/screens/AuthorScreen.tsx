import { useEffect, useMemo, useRef, useState } from "react";
import {
  authorStats, booksOfAuthor, filterAuthorBooks, formatRefreshDate, plural,
  type AuthorBookFilter, type AuthorBookSort
} from "../lib/library-view";
import { enrichLibraryBooks, refreshAuthor, unfollowAuthor } from "../services/authorLibrary";
import { getFollowedAuthor, updateLibraryBook } from "../services/library";
import { useLibrary } from "../state/LibraryProvider";
import { useNavigation } from "../state/NavigationProvider";
import { usePreferences } from "../state/PreferencesProvider";

export function AuthorScreen({ authorKey, authorName }: { authorKey: string; authorName: string }) {
  const { library, setLibrary } = useLibrary();
  const nav = useNavigation();
  const { preferredLanguage } = usePreferences();

  const [filter, setFilter] = useState<AuthorBookFilter>("ALL");
  const [sort, setSort] = useState<AuthorBookSort>("MISSING");
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | undefined>();
  const [refreshBusy, setRefreshBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const books = useMemo(() => booksOfAuthor(library, authorKey), [library, authorKey]);
  const visible = useMemo(() => filterAuthorBooks(books, filter, sort), [books, filter, sort]);
  const stats = authorStats(books);

  // À l'ouverture : date de dernière actualisation, puis jaquettes manquantes en arrière-plan.
  const booksRef = useRef(books);
  booksRef.current = books;
  useEffect(() => {
    let active = true;
    getFollowedAuthor(authorKey).then(info => { if (active) setLastRefreshedAt(info?.lastRefreshedAt); }, () => undefined);
    void enrichLibraryBooks(booksRef.current, booksRef.current, preferredLanguage).then(updated => { if (active && updated) setLibrary(updated); });
    return () => { active = false; };
  }, [authorKey, preferredLanguage, setLibrary]);

  async function quickPatch(id: string, changes: Parameters<typeof updateLibraryBook>[1]) {
    try { setLibrary(await updateLibraryBook(id, changes)); }
    catch (x) { setError(x instanceof Error ? x.message : "Modification impossible."); }
  }

  async function refresh() {
    if (refreshBusy) return;
    setRefreshBusy(true);
    setMessage("");
    setError("");
    try {
      const result = await refreshAuthor(authorKey, authorName, library, preferredLanguage);
      setLibrary(result.library);
      setLastRefreshedAt(result.refreshedAt);
      setMessage(result.newCount
        ? `${result.newCount} ${plural(result.newCount, "nouvelle")} ${plural(result.newCount, "œuvre")} ${plural(result.newCount, "détectée")}.`
        : "Bibliographie à jour : aucune nouvelle œuvre détectée.");
      if (result.newCount) setFilter("ALL");
      void enrichLibraryBooks(result.remote, result.library, preferredLanguage).then(updated => { if (updated) setLibrary(updated); });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Impossible d’actualiser cette bibliographie.");
    } finally {
      setRefreshBusy(false);
    }
  }

  async function remove() {
    if (deleteBusy || books.length === 0) return;
    const confirmed = window.confirm(
      `Supprimer ${authorName || "cet auteur"} et toute sa bibliographie suivie de Tsundoku ?\n\n${books.length} ${plural(books.length, "livre")} ${plural(books.length, "sera", "seront")} retiré${books.length > 1 ? "s" : ""} de la bibliothèque locale, avec leurs statuts Possédé/Lu.`
    );
    if (!confirmed) return;
    setDeleteBusy(true);
    setError("");
    try {
      setLibrary(await unfollowAuthor(authorKey, books));
      nav.reset({ name: "library" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Impossible de supprimer cet auteur.");
      setDeleteBusy(false);
    }
  }

  const filterButton = (value: AuthorBookFilter, label: string, count: number, extra = "") =>
    <button className={`${filter === value ? "filter active" : "filter"}${extra}`} onClick={() => setFilter(value)}>{label} <span>{count}</span></button>;

  return <>
    <section className="author-bibliography-header">
      <div className="author-header-main">
        <div>
          <button type="button" className="text-button" onClick={nav.back}>← Retour</button>
          <p className="eyebrow">Bibliographie suivie</p>
          <h2>{authorName}</h2>
          <p>{stats.total} {plural(stats.total, "œuvre")}</p>
          <div className="author-stat-grid" aria-label="Résumé de la bibliographie">
            <button type="button" className="author-stat missing" onClick={() => setFilter("MISSING")}><strong>{stats.missing}</strong><span>{plural(stats.missing, "Manquant")}</span></button>
            <button type="button" className="author-stat owned" onClick={() => setFilter("OWNED")}><strong>{stats.owned}</strong><span>{plural(stats.owned, "Possédé")}</span></button>
            <button type="button" className="author-stat read" onClick={() => setFilter("READ")}><strong>{stats.read}</strong><span>{plural(stats.read, "Lu")}</span></button>
          </div>
        </div>
        <div className="author-header-actions">
          <div className="author-refresh-status">
            <small>Dernière actualisation</small>
            <strong>{formatRefreshDate(lastRefreshedAt)}</strong>
            {stats.newlyDiscovered > 0 && <span className="new-count">{stats.newlyDiscovered} {plural(stats.newlyDiscovered, "nouveauté")}</span>}
          </div>
          <button type="button" className="refresh-author-button" disabled={refreshBusy} onClick={() => void refresh()}>
            {refreshBusy ? "Actualisation…" : "↻ Actualiser la bibliographie"}
          </button>
          <button type="button" className="danger-button author-delete-button" disabled={deleteBusy} onClick={() => void remove()}>
            {deleteBusy ? "Suppression…" : "Supprimer l’auteur"}
          </button>
        </div>
      </div>
      {message && <p className="author-refresh-message">{message}</p>}
      {error && <p className="error">{error}</p>}
      <p className="author-delete-help">Retire cet auteur et toute sa bibliographie suivie de Tsundoku. Une confirmation sera demandée.</p>
    </section>

    <section className="author-toolbar">
      <div className="filter-row author-filters">
        {filterButton("ALL", "Tous", stats.total)}
        {filterButton("MISSING", "Manquants", stats.missing, " missing-filter")}
        {filterButton("OWNED", "Possédés", stats.owned)}
        {filterButton("READ", "Lus", stats.read)}
        {filterButton("TO_READ", "Non lus", stats.unread)}
      </div>
      <select value={sort} onChange={e => setSort(e.target.value as AuthorBookSort)}>
        <option value="MISSING">Manquants d’abord</option>
        <option value="TITLE">Titre</option>
        <option value="DATE">Parution récente</option>
      </select>
    </section>

    <div className="author-book-list author-book-list-flat">
      {visible.map(book => <article className={`author-book-row ${book.owned ? "owned" : "missing"}`} key={book.id}>
        <button type="button" className="book-row-main" onClick={() => nav.push({ name: "detail", id: book.id })}>
          {book.coverUrl ? <img src={book.coverUrl} alt="" /> : <div className="mini-cover">📖</div>}
          <span><small>{book.publishedYear ?? "Date inconnue"} {book.newlyDiscovered && <b className="new-book-badge">Nouveau</b>}</small><strong>{book.title}</strong><em>{book.publisher ?? ""}</em></span>
        </button>
        <div className="quick-book-actions">
          <button type="button" className={book.owned ? "state-toggle active-owned" : "state-toggle"} onClick={() => void quickPatch(book.id, { owned: !book.owned })}>{book.owned ? "✓ Possédé" : "✗ Manquant"}</button>
          <button type="button" className={book.status === "READ" ? "state-toggle active-read" : "state-toggle"} onClick={() => void quickPatch(book.id, { status: book.status === "READ" ? "TO_READ" : "READ" })}>{book.status === "READ" ? "✓ Lu" : "○ Non lu"}</button>
        </div>
      </article>)}
    </div>
    {visible.length === 0 && <section className="empty-state"><div>📚</div><h2>Aucun livre dans ce filtre</h2><p>Choisis un autre filtre pour voir la bibliographie.</p></section>}
  </>;
}
