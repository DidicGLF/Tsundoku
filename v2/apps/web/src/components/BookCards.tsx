import type { BookSearchResult } from "@tsundoku/book-sources";
import { getBookLanguageLabel } from "../services/bookSearch";
import type { LibraryBook } from "../services/library";
import { Cover } from "./Cover";
import { displayAuthors, readPercent, type LibraryState } from "../lib/library-view";
import { Check, Heart, Star } from "./Icons";

const sourceLabels = { "google-books": "Google Books", bnf: "BnF", "open-library": "Open Library" } as const;

export function SearchCard({ b, onAdd, onTrack, state = "none" }: {
  b: BookSearchResult; onAdd?: (b: BookSearchResult) => void; onTrack?: (b: BookSearchResult) => void; state?: LibraryState;
}) {
  return <article className="card">
    <Cover book={b} />
    <div>
      <small>{sourceLabels[b.source]} · <span className="language-badge">{getBookLanguageLabel(b)}</span></small>
      <h3>{b.title}</h3>
      <p>{displayAuthors(b.authors)}</p>
      {state === "tracked" && <p className="card-state">Dans ta bibliothèque, pas encore possédé</p>}
      {onAdd && <div className="card-actions">
        {state === "owned"
          ? <button disabled><Check size={16} /> Possédé</button>
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
    <span className="tile-title">{b.title}</span>
  </button>;
}
