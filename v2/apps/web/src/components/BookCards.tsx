import { publisherName, type BookSearchResult } from "@tsundoku/book-sources";
import { getBookLanguageLabel } from "../services/bookSearch";
import type { LibraryBook } from "../services/library";
import { Cover } from "./Cover";
import { displayAuthors, displayTitle, readPercent, type LibraryState } from "../lib/library-view";
import { Check, Heart, Star } from "./Icons";

const sourceLabels = { "google-books": "Google Books", bnf: "BnF", "open-library": "Open Library", manual: "Saisie manuelle" } as const;

/** « 9782266110075 (2266110071) » : les deux ISBN quand on les connaît. */
function isbnLabel(book: { isbn13?: string; isbn10?: string }): string {
  if (book.isbn13 && book.isbn10) return `${book.isbn13} (${book.isbn10})`;
  return book.isbn13 ?? book.isbn10 ?? "";
}

export function SearchCard({ b, onAdd, onTrack, onAdopt, state = "none", local }: {
  b: BookSearchResult; onAdd?: (b: BookSearchResult) => void; onTrack?: (b: BookSearchResult) => void; onAdopt?: (b: BookSearchResult) => void; state?: LibraryState;
  /** La fiche de ta bibliothèque pour cette œuvre, pour comparer les ISBN. */
  local?: { isbn13?: string; isbn10?: string };
}) {
  const details = [publisherName(b.publisher), b.publishedYear ? String(b.publishedYear) : "", b.pageCount ? `${b.pageCount} p.` : ""].filter(Boolean).join(" · ");
  const isbn = isbnLabel(b);
  const localIsbn = local ? isbnLabel(local) : "";
  return <article className="card">
    <Cover book={b} />
    <div>
      <small>{sourceLabels[b.source]} · <span className="language-badge">{getBookLanguageLabel(b)}</span></small>
      <h3>{displayTitle(b.title)}</h3>
      <p>{displayAuthors(b.authors)}</p>
      {details && <p className="card-details">{details}</p>}
      {b.collection && <p className="card-details">Collection : {b.collection}</p>}
      {isbn && <p className="card-isbn">ISBN <span>{isbn}</span></p>}
      {state === "tracked" && <p className="card-state">Dans ta bibliothèque, pas encore possédé</p>}
      {state === "owned-other-edition" && <p className="card-state">Possédé, avec une autre édition enregistrée (ISBN ou jaquette différents)</p>}
      {localIsbn && state !== "none" && state !== "owned" && <p className="card-isbn">Ta fiche : ISBN <span>{localIsbn}</span></p>}
      {onAdd && <div className="card-actions">
        {state === "owned"
          ? <button disabled><Check size={16} /> Possédé</button>
          : state === "owned-other-edition"
            ? <button onClick={() => (onAdopt ?? onAdd)(b)}>C'est mon édition</button>
            : <button onClick={() => onAdd(b)}>Je le possède</button>}
        {onTrack && state === "none" && <button className="secondary-inline" onClick={() => onTrack(b)}>Je ne le possède pas</button>}
      </div>}
    </div>
  </article>;
}

/** Tuile de la grille de la bibliothèque : la couverture d'abord, l'état en pastille. */
export function LibraryTile({ b, onOpen }: { b: LibraryBook; onOpen: (b: LibraryBook) => void }) {
  const percent = readPercent(b);
  return <button type="button" className={b.owned ? "tile" : "tile missing"} onClick={() => onOpen(b)}>
    <span className="tile-art">
      <Cover book={b} variant="tile" />
      {b.owned && <span className="tile-owned" role="img" aria-label="Possédé"><Check size={14} strokeWidth={3.2} /></span>}
      {b.favorite && <span className="tile-fav" role="img" aria-label="Favori"><Heart size={14} filled /></span>}
      {!b.owned && <span className="tile-missing">Manquant</span>}
      {b.owned && b.status === "READING" && <span className="tile-progress" role="img" aria-label={`${percent} % lu`}><i style={{ width: `${percent}%` }} /></span>}
      {b.status === "READ" && b.rating != null && <span className="tile-rating"><Star filled size={12} />{b.rating}</span>}
    </span>
    <span className="tile-title">{displayTitle(b.title)}</span>
  </button>;
}
