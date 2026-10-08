import { useEffect, useState, type FormEvent } from "react";
import { cleanIsbn } from "@tsundoku/book-sources";
import { fileToCoverDataUrl } from "../services/coverImage";
import { fetchCoverCandidates, type CoverCandidate } from "../services/coverCandidates";
import type { LibraryBook } from "../services/library";

/**
 * Feuille « Changer de jaquette » : les jaquettes de l'ISBN de la fiche, puis celles d'un autre ISBN
 * (celui de l'exemplaire qu'on a en main) ou une photo de son propre exemplaire.
 */
export function CoverPicker({ book, onPick, onClose }: {
  book: Pick<LibraryBook, "isbn13" | "isbn10" | "coverUrl" | "title">;
  /** `url` null : retirer la jaquette. `isbn` : l'exemplaire a un autre ISBN que la fiche. */
  onPick: (url: string | null, isbn?: string) => void;
  onClose: () => void;
}) {
  const ownIsbn = book.isbn13 ?? book.isbn10;
  const [activeIsbn, setActiveIsbn] = useState<string | undefined>(ownIsbn);
  const [candidates, setCandidates] = useState<CoverCandidate[] | null>(null);
  const [isbnInput, setIsbnInput] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    setCandidates(null);
    if (!activeIsbn) { setCandidates([]); return; }
    const clean = cleanIsbn(activeIsbn) ?? "";
    fetchCoverCandidates(clean.length === 10 ? { isbn10: clean } : { isbn13: clean }).then(
      found => { if (active) setCandidates(found); },
      () => { if (active) setCandidates([]); }
    );
    return () => { active = false; };
  }, [activeIsbn]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function searchIsbn(event: FormEvent) {
    event.preventDefault();
    const clean = cleanIsbn(isbnInput);
    if (!clean) { setMessage("Cet ISBN n'est pas valide (10 ou 13 chiffres)."); return; }
    setMessage("");
    setActiveIsbn(clean);
  }

  async function usePhoto(file: File | undefined) {
    if (!file) return;
    setMessage("");
    try { onPick(await fileToCoverDataUrl(file), activeIsbn !== ownIsbn ? activeIsbn : undefined); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Image illisible."); }
  }

  const other = activeIsbn !== ownIsbn;
  return <div className="sheet-backdrop" onClick={onClose}>
    <div className="sheet" role="dialog" aria-modal="true" aria-label="Changer de jaquette" onClick={event => event.stopPropagation()}>
      <div className="sheet-heading">
        <h3>Changer de jaquette</h3>
        <button type="button" className="icon-button" aria-label="Fermer" onClick={onClose}>✕</button>
      </div>

      {!activeIsbn && <p className="sheet-note">Ce livre n'a pas d'ISBN : saisis celui de ton exemplaire ci-dessous, ou prends-le en photo.</p>}
      {activeIsbn && candidates === null && <p className="sheet-note" role="status">Recherche des jaquettes…</p>}
      {activeIsbn && candidates && candidates.length === 0 && <p className="sheet-note">Aucune jaquette trouvée pour l'ISBN {activeIsbn}.</p>}
      {candidates && candidates.length > 0 && <>
        <p className="sheet-note">
          {other ? `Jaquettes pour l'ISBN ${activeIsbn} : si tu en choisis une, la fiche prend aussi cet ISBN.` : `Touche celle qui ressemble à ton exemplaire. Les premières sont celles de l'ISBN ${activeIsbn}.`}
        </p>
        <div className="cover-options">
          {candidates.map(candidate =>
            <button key={candidate.id} type="button" className={!other && candidate.url === book.coverUrl ? "cover-option current" : "cover-option"}
              onClick={() => onPick(candidate.url, other ? activeIsbn : undefined)}>
              <img src={candidate.thumb} alt="" loading="lazy" />
              <span>{!other && candidate.url === book.coverUrl ? "Actuelle · " : ""}{candidate.label}</span>
            </button>)}
        </div>
      </>}

      <form className="sheet-section" onSubmit={searchIsbn}>
        <label htmlFor="cover-isbn">Ton exemplaire a un autre ISBN ?</label>
        <div className="sheet-row">
          <input id="cover-isbn" inputMode="numeric" placeholder="ISBN au dos du livre" value={isbnInput} onChange={event => setIsbnInput(event.target.value)} />
          <button type="submit" disabled={!isbnInput.trim()}>Chercher</button>
        </div>
      </form>

      <div className="sheet-section">
        <label className="file-button">
          Prendre une photo ou choisir une image
          <input type="file" accept="image/*" hidden onChange={event => void usePhoto(event.target.files?.[0])} />
        </label>
        <p className="sheet-note">La jaquette de ton exemplaire, telle qu'elle est : elle reste sur ce téléphone.</p>
      </div>

      {message && <p className="error">{message}</p>}
      {book.coverUrl && <button type="button" className="link-danger" onClick={() => onPick(null)}>Retirer la jaquette</button>}
    </div>
  </div>;
}
