import { useEffect, useState } from "react";
import { fetchCoverCandidates, type CoverCandidate } from "../services/coverCandidates";
import type { LibraryBook } from "../services/library";

/** Feuille « Changer de jaquette » : les jaquettes de l'édition d'abord, puis celles des autres éditions. */
export function CoverPicker({ book, onPick, onClose }: {
  book: Pick<LibraryBook, "isbn13" | "isbn10" | "coverUrl" | "title">;
  /** `null` : retirer la jaquette (la tuile de substitution prend la place). */
  onPick: (url: string | null) => void;
  onClose: () => void;
}) {
  const [candidates, setCandidates] = useState<CoverCandidate[] | null>(null);

  useEffect(() => {
    let active = true;
    fetchCoverCandidates(book).then(
      found => { if (active) setCandidates(found); },
      () => { if (active) setCandidates([]); }
    );
    return () => { active = false; };
  }, [book.isbn13, book.isbn10]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const hasIsbn = Boolean(book.isbn13 || book.isbn10);
  return <div className="sheet-backdrop" onClick={onClose}>
    <div className="sheet" role="dialog" aria-modal="true" aria-label="Changer de jaquette" onClick={event => event.stopPropagation()}>
      <div className="sheet-heading">
        <h3>Changer de jaquette</h3>
        <button type="button" className="icon-button" aria-label="Fermer" onClick={onClose}>✕</button>
      </div>
      {!hasIsbn && <p className="sheet-note">Ce livre n'a pas d'ISBN : aucune jaquette ne peut être proposée automatiquement.</p>}
      {hasIsbn && candidates === null && <p className="sheet-note" role="status">Recherche des jaquettes…</p>}
      {candidates && candidates.length === 0 && hasIsbn && <p className="sheet-note">Aucune jaquette trouvée pour cet ISBN.</p>}
      {candidates && candidates.length > 0 && <>
        <p className="sheet-note">Touche celle qui ressemble à ton exemplaire. Les premières sont celles de ton édition (ISBN {book.isbn13 ?? book.isbn10}).</p>
        <div className="cover-options">
          {candidates.map(candidate =>
            <button key={candidate.id} type="button" className={candidate.url === book.coverUrl ? "cover-option current" : "cover-option"} onClick={() => onPick(candidate.url)}>
              <img src={candidate.thumb} alt="" loading="lazy" />
              <span>{candidate.url === book.coverUrl ? "Actuelle · " : ""}{candidate.label}</span>
            </button>)}
        </div>
      </>}
      {book.coverUrl && <button type="button" className="link-danger" onClick={() => onPick(null)}>Retirer la jaquette</button>}
    </div>
  </div>;
}
