import { useEffect, useRef, useState } from "react";
import { canonicalAuthorIdentity } from "@tsundoku/book-sources";
import type { ReadingStatus } from "@tsundoku/database";
import { Check, ChevronLeft, Heart, BookOpen, Star } from "../components/Icons";
import { Cover, hueOf } from "../components/Cover";
import {
  bookDatesLine, displayAuthors, pageReached, primaryAuthor, progressUpdateFor, ratingLabels, readPercent
} from "../lib/library-view";
import { getBookLanguageName } from "../services/language";
import { removeBookFromLibrary, updateLibraryBook, type LibraryBook } from "../services/library";
import { useLibrary } from "../state/LibraryProvider";
import { useNavigation } from "../state/NavigationProvider";

const STATUSES: Array<[ReadingStatus, string]> = [["TO_READ", "À lire"], ["READING", "En cours"], ["READ", "Lu"]];
const PROGRESS_SHORTCUTS: Array<[string, number]> = [["Début", 5], ["25 %", 25], ["Moitié", 50], ["75 %", 75], ["Presque fini", 95]];
const SUMMARY_PREVIEW = 220;

export function BookDetailScreen({ book }: { book: LibraryBook }) {
  const { setLibrary } = useLibrary();
  const nav = useNavigation();
  const [error, setError] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);

  async function patch(changes: Parameters<typeof updateLibraryBook>[1]) {
    try { setLibrary(await updateLibraryBook(book.id, changes)); }
    catch (x) { setError(x instanceof Error ? x.message : "Modification impossible."); }
  }

  // Le curseur suit le doigt sans attendre la base : on n'enregistre qu'une fois le geste terminé.
  const [percent, setPercent] = useState(() => readPercent(book));
  const savedPercent = useRef(percent);
  useEffect(() => {
    if (percent === savedPercent.current) return;
    const timer = setTimeout(() => {
      savedPercent.current = percent;
      void patch({ ...progressUpdateFor(book, percent), ...(book.status === "TO_READ" && percent > 0 ? { status: "READING" as const } : {}) });
    }, 300);
    return () => clearTimeout(timer);
  }, [percent]);

  async function remove() {
    if (deleteBusy) return;
    if (!window.confirm(`Retirer « ${book.title} » de ta bibliothèque ?\n\nSon statut, sa note et sa progression seront aussi supprimés.`)) return;
    setDeleteBusy(true);
    setError("");
    try {
      const next = await removeBookFromLibrary(book.id);
      nav.back();
      setLibrary(next);
    } catch (x) {
      setError(x instanceof Error ? x.message : "Suppression impossible.");
      setDeleteBusy(false);
    }
  }

  const author = primaryAuthor(book);
  const page = pageReached(book, percent);
  const facts: Array<[string, string]> = [
    ["Éditeur", book.publisher ?? ""],
    ["Parution", book.publishedYear ? String(book.publishedYear) : ""],
    ["Pages", book.pageCount ? String(book.pageCount) : ""],
    ["Langue", getBookLanguageName(book)],
    ["ISBN", book.isbn13 ?? book.isbn10 ?? ""]
  ];
  const shownFacts = facts.filter(([, value]) => value);
  const description = book.description?.trim();
  const longSummary = Boolean(description && description.length > SUMMARY_PREVIEW);

  return <article className="book-page" style={{ "--hue": hueOf(book.title) } as React.CSSProperties}>
    <div className="book-hero">
      <button type="button" className="icon-button" aria-label="Retour" onClick={nav.back}><ChevronLeft size={24} /></button>
      <div className="book-hero-cover"><Cover book={book} variant="detail" /></div>
      <h2 className="book-title">{book.title}</h2>
      {author && author !== "Auteur inconnu" &&
        <button type="button" className="book-author" onClick={() => nav.push({ name: "author", key: canonicalAuthorIdentity(author), authorName: author })}>{displayAuthors(book.authors)}</button>}
      {book.seriesName && <p className="series-chip"><BookOpen size={14} /> {book.seriesName}{book.seriesVolume != null ? ` · tome ${book.seriesVolume}` : ""}</p>}
    </div>

    {error && <p className="error">{error}</p>}

    <div className="book-pills">
      <button type="button" className={book.owned ? "pill owned on" : "pill owned"} aria-pressed={book.owned} onClick={() => void patch({ owned: !book.owned })}>
        {book.owned && <Check size={18} />}{book.owned ? "Possédé" : "Non possédé"}
      </button>
      <button type="button" className={book.favorite ? "pill favorite on" : "pill favorite"} aria-pressed={book.favorite} onClick={() => void patch({ favorite: !book.favorite })}>
        <Heart size={18} filled={book.favorite} /> Favori
      </button>
    </div>

    <div className="segmented" role="group" aria-label="Statut de lecture">
      {STATUSES.map(([value, label]) =>
        <button key={value} type="button" className={book.status === value ? "on" : ""} aria-pressed={book.status === value} onClick={() => void patch({ status: value })}>{label}</button>)}
    </div>

    {book.status === "READING" && <section className="block progress-block">
      <div className="block-heading"><strong>Où en es-tu ?</strong>{page != null && <span>page {page} sur {book.pageCount}</span>}</div>
      <div className="progress-percent">{percent} %</div>
      <div className="bookmark-slider">
        <div className="bookmark-track"><i style={{ width: `${percent}%` }} /></div>
        <svg className="bookmark-thumb" style={{ left: `calc(${percent}% - ${(percent * 22) / 100}px)` }} width="22" height="30" viewBox="0 0 22 30" aria-hidden="true">
          <path d="M2 2a2 2 0 012-2h14a2 2 0 012 2v26l-9-6-9 6z" fill="currentColor" />
        </svg>
        <input type="range" min={0} max={100} step={1} value={percent} onChange={e => setPercent(Number(e.target.value))} aria-label="Avancement de la lecture, en pourcentage" />
      </div>
      <div className="shortcuts">
        {PROGRESS_SHORTCUTS.map(([label, value]) =>
          <button key={label} type="button" className={Math.abs(percent - value) <= 2 ? "chip on" : "chip"} onClick={() => setPercent(value)}>{label}</button>)}
      </div>
    </section>}

    {book.status === "READ" && <section className="block rating-block">
      <div className="block-heading"><strong>Ma note</strong><span>{ratingLabels[book.rating ?? 0]}</span></div>
      <div className="stars">
        {[1, 2, 3, 4, 5].map(n =>
          <button key={n} type="button" aria-label={`${n} ${n > 1 ? "étoiles" : "étoile"}`} aria-pressed={book.rating === n}
            onClick={() => void patch({ rating: book.rating === n ? null : n })}>
            <Star filled={(book.rating ?? 0) >= n} />
          </button>)}
      </div>
    </section>}
    {book.status === "READING" && <p className="book-hint">Tu pourras noter ce livre avec des étoiles une fois terminé.</p>}

    <p className="book-dates">{bookDatesLine(book)}</p>

    {description && <section className="book-summary">
      <strong>Résumé</strong>
      <p className={expanded ? "" : "clamped"}>{description}</p>
      {longSummary && <button type="button" className="text-button" onClick={() => setExpanded(!expanded)}>{expanded ? "Réduire" : "Lire la suite"}</button>}
    </section>}

    {shownFacts.length > 0 && <dl className="book-facts">
      {shownFacts.map(([label, value]) => <div key={label} className={label === "ISBN" ? "wide" : undefined}><dt>{label}</dt><dd>{value}</dd></div>)}
    </dl>}

    <div className="book-remove">
      <button type="button" className="link-danger" disabled={deleteBusy} onClick={() => void remove()}>
        {deleteBusy ? "Suppression…" : "Retirer de ma bibliothèque"}
      </button>
    </div>
  </article>;
}
