import type { BookSearchResult } from "@tsundoku/book-sources";
import { getBookLanguageLabel } from "../services/bookSearch";
import type { LibraryBook } from "../services/library";
import { Cover } from "./Cover";
import { displayAuthors, statusLabels } from "../lib/library-view";

const sourceLabels = { "google-books": "Google Books", bnf: "BnF", "open-library": "Open Library" } as const;

export function SearchCard({ b, onAdd, onTrack, added }: {
  b: BookSearchResult; onAdd?: (b: BookSearchResult) => void; onTrack?: (b: BookSearchResult) => void; added?: boolean;
}) {
  return <article className="card">
    <Cover book={b} />
    <div>
      <small>{sourceLabels[b.source]} · <span className="language-badge">{getBookLanguageLabel(b)}</span></small>
      <h3>{b.title}</h3>
      <p>{displayAuthors(b.authors)}</p>
      {onAdd && <div className="card-actions">
        <button disabled={added} onClick={() => onAdd(b)}>{added ? "Ajouté" : "Je le possède"}</button>
        {onTrack && !added && <button className="secondary-inline" onClick={() => onTrack(b)}>Je ne le possède pas</button>}
      </div>}
    </div>
  </article>;
}

export function LibraryCard({ b, onOpen }: { b: LibraryBook; onOpen: (b: LibraryBook) => void }) {
  const progress = b.progressTotal && b.progressValue != null
    ? Math.min(100, Math.round((b.progressValue / b.progressTotal) * 100))
    : undefined;

  return <article className="card library-card" onClick={() => onOpen(b)}>
    <Cover book={b} />
    <div>
      <small>{b.owned ? "✓ Possédé" : "○ Non possédé"} · {statusLabels[b.status]} {b.favorite ? "★" : ""}</small>
      <h3>{b.title}</h3>
      <p>{displayAuthors(b.authors)}</p>
      {progress != null && <div className="progress"><i style={{ width: `${progress}%` }} /></div>}
      {progress != null && <p>{progress}% · {b.progressValue}/{b.progressTotal}</p>}
    </div>
  </article>;
}

