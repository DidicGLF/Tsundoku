import { Check, Bookmark, ChevronLeft, Refresh } from "../components/Icons";
import { Cover } from "../components/Cover";
import { useAuthorInfo } from "../hooks/useAuthorInfo";
import { formatLifespan } from "../lib/author-info";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  authorStats, booksOfAuthor, filterAuthorBooks, formatRefreshDate, groupBySeries, initialsOf, plural,
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [bioOpen, setBioOpen] = useState(false);
  const [photoBroken, setPhotoBroken] = useState(false);
  const info = useAuthorInfo(authorName);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  // idle : rien à chercher · running : recherche en cours · done : terminée · partial : plafond atteint
  const [coverStatus, setCoverStatus] = useState<"idle" | "running" | "done" | "partial">("idle");

  const books = useMemo(() => booksOfAuthor(library, authorKey), [library, authorKey]);
  const visible = useMemo(() => filterAuthorBooks(books, filter, sort), [books, filter, sort]);
  const stats = authorStats(books);
  const withCover = books.filter(book => book.coverUrl).length;
  const withoutCover = books.length - withCover;
  const groups = useMemo(() => groupBySeries(visible), [visible]);
  const readPct = stats.total ? (stats.read / stats.total) * 100 : 0;
  const ownedOnlyPct = stats.total ? (Math.max(0, stats.owned - stats.read) / stats.total) * 100 : 0;

  // À l'ouverture : date de dernière actualisation, puis jaquettes manquantes en arrière-plan.
  const booksRef = useRef(books);
  booksRef.current = books;
  useEffect(() => {
    let active = true;
    getFollowedAuthor(authorKey).then(info => { if (active) setLastRefreshedAt(info?.lastRefreshedAt); }, () => undefined);
    setCoverStatus(booksRef.current.some(book => !book.coverUrl) ? "running" : "idle");
    void enrichLibraryBooks(booksRef.current, booksRef.current, preferredLanguage, updated => { if (active) setLibrary(updated); })
      .then(({ truncated }) => { if (active) setCoverStatus(truncated ? "partial" : "done"); });
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
      setCoverStatus("running");
      void enrichLibraryBooks(result.remote, result.library, preferredLanguage, setLibrary)
        .then(({ truncated }) => setCoverStatus(truncated ? "partial" : "done"));
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

  const bookRow = (book: (typeof visible)[number]) =>
    <article className={`author-book-row ${book.owned ? "owned" : "missing"}`} key={book.id}>
      <button type="button" className="book-row-main" onClick={() => nav.push({ name: "detail", id: book.id })}>
        <Cover book={book} variant="mini" />
        <span>
          <strong>{book.title}</strong>
          <em>{[book.seriesVolume != null ? `Tome ${book.seriesVolume}` : "", book.publishedYear ? String(book.publishedYear) : "", book.publisher ?? ""].filter(Boolean).join(" · ")}</em>
          {book.newlyDiscovered && <b className="new-book-badge">Nouveau</b>}
        </span>
      </button>
      <div className="quick-book-actions">
        <button type="button" className={book.owned ? "round-toggle owned on" : "round-toggle owned"} aria-label="Possédé" aria-pressed={book.owned}
          onClick={() => void quickPatch(book.id, { owned: !book.owned })}><Check size={22} /></button>
        <button type="button" className={book.status === "READ" ? "round-toggle read on" : "round-toggle read"} aria-label="Lu" aria-pressed={book.status === "READ"}
          onClick={() => void quickPatch(book.id, { status: book.status === "READ" ? "TO_READ" : "READ" })}><Bookmark size={22} filled={book.status === "READ"} /></button>
      </div>
    </article>;

  return <div className="author-page">
    <div className="topbar">
      <button type="button" className="icon-button" aria-label="Retour" onClick={nav.back}><ChevronLeft size={24} /></button>
      <div className="topbar-actions">
        <button type="button" className={refreshBusy ? "icon-button spinning" : "icon-button"} aria-label="Actualiser la bibliographie" disabled={refreshBusy} onClick={() => void refresh()}><Refresh size={22} /></button>
        <div className="menu-anchor">
          <button type="button" className="icon-button" aria-label="Plus d’actions" aria-expanded={menuOpen} onClick={() => setMenuOpen(open => !open)}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
          </button>
          {menuOpen && <div className="menu" role="menu">
            <button type="button" role="menuitem" className="menu-danger" disabled={deleteBusy} onClick={() => { setMenuOpen(false); void remove(); }}>
              {deleteBusy ? "Suppression…" : "Supprimer l’auteur et ses livres"}
            </button>
          </div>}
        </div>
      </div>
    </div>

    <div className="author-head">
      {info?.photoUrl && !photoBroken
        ? <img className="author-photo" src={info.photoUrl} alt="" onError={() => setPhotoBroken(true)} />
        : <div className="monogram" aria-hidden="true">{initialsOf(authorName)}</div>}
      <div>
        <h1>{authorName}</h1>
        {info && (info.description || formatLifespan(info)) &&
          <p className="author-tagline">{[info.description ? info.description.charAt(0).toUpperCase() + info.description.slice(1) : "", formatLifespan(info)].filter(Boolean).join(" · ")}</p>}
        <p>{stats.total} {plural(stats.total, "œuvre")} {plural(stats.total, "suivie")} · actualisé {formatRefreshDate(lastRefreshedAt)}</p>
        {stats.newlyDiscovered > 0 && <span className="new-count">{stats.newlyDiscovered} {plural(stats.newlyDiscovered, "nouveauté")}</span>}
      </div>
    </div>

    {info?.bio && <section className="author-bio">
      <p className={bioOpen ? "" : "clamped"}>{info.bio}</p>
      <div className="author-bio-footer">
        <button type="button" className="text-button" onClick={() => setBioOpen(!bioOpen)}>{bioOpen ? "Réduire" : "Lire la suite"}</button>
        <span>Source : {info.pageUrl ? <a href={info.pageUrl} target="_blank" rel="noreferrer">Wikipédia</a> : "Open Library"}</span>
      </div>
    </section>}

    {message && <p className="author-refresh-message">{message}</p>}
    {error && <p className="error">{error}</p>}

    <section className="author-summary" aria-label="Résumé de la bibliographie">
      <div className="stack-bar" aria-hidden="true"><i className="read" style={{ width: `${readPct}%` }} /><i className="owned" style={{ width: `${ownedOnlyPct}%` }} /></div>
      <div className="summary-buttons">
        <button type="button" onClick={() => setFilter("READ")}><span><i className="dot read" />{plural(stats.read, "Lu")}</span><strong>{stats.read}</strong></button>
        <button type="button" onClick={() => setFilter("OWNED")}><span><i className="dot owned" />{plural(stats.owned, "Possédé")}</span><strong>{stats.owned}</strong></button>
        <button type="button" onClick={() => setFilter("MISSING")}><span><i className="dot missing" />{plural(stats.missing, "Manquant")}</span><strong className="missing">{stats.missing}</strong></button>
      </div>
    </section>

    {coverStatus === "running" && <p className="cover-status running" role="status">Recherche des jaquettes… {withCover} / {books.length}</p>}
    {coverStatus === "partial" && withoutCover > 0 && <p className="cover-status" role="status">
      Recherche partielle : {withoutCover} {plural(withoutCover, "livre")} sans jaquette, la suite reprendra à la prochaine ouverture de cette page.
    </p>}
    {coverStatus === "done" && withoutCover > 0 && <p className="cover-status" role="status">
      {withoutCover} {plural(withoutCover, "livre")} sans jaquette disponible pour l’instant (nouvelle tentative dans 7 jours).
    </p>}

    <section className="author-toolbar">
      <div className="filter-row author-filters">
        {filterButton("MISSING", "Manquants", stats.missing, " missing-filter")}
        {filterButton("ALL", "Tous", stats.total)}
        {filterButton("OWNED", "Possédés", stats.owned)}
        {filterButton("READ", "Lus", stats.read)}
        {filterButton("TO_READ", "Non lus", stats.unread)}
      </div>
      <select value={sort} onChange={e => setSort(e.target.value as AuthorBookSort)} aria-label="Trier">
        <option value="MISSING">Manquants d’abord</option>
        <option value="TITLE">Titre</option>
        <option value="DATE">Parution récente</option>
      </select>
    </section>

    {groups.map(group => <section key={group.name ?? "standalone"} className="series-group">
      {(group.name || groups.length > 1) && <div className="series-heading">
        <h2>{group.name ?? "Hors série"}</h2>
        <span>{group.books.filter(book => book.owned).length} / {group.books.length}</span>
      </div>}
      <div className="author-book-list">{group.books.map(bookRow)}</div>
    </section>)}
    {visible.length === 0 && <section className="empty-state"><div>📚</div><h2>Aucun livre dans ce filtre</h2><p>Choisis un autre filtre pour voir la bibliographie.</p></section>}
  </div>;
}
