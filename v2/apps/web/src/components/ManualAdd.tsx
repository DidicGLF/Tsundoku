import { useState, type FormEvent } from "react";
import { canonicalIsbn, cleanIsbn, isbn10To13, type BookSearchResult } from "@tsundoku/book-sources";

/** Livre absent des catalogues : on le saisit à la main (titre, auteur), l'ISBN éventuel est repris. */
export function ManualAdd({ initialTitle = "", isbn, onAdd }: {
  initialTitle?: string;
  isbn?: string;
  onAdd: (book: BookSearchResult, owned: boolean) => Promise<void>;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [author, setAuthor] = useState("");
  const [busy, setBusy] = useState(false);

  const clean = cleanIsbn(isbn);
  const isbn13 = clean?.length === 13 ? clean : clean ? isbn10To13(clean) : undefined;

  async function submit(owned: boolean, event?: FormEvent) {
    event?.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    const book: BookSearchResult = {
      source: "manual",
      sourceId: `manual:${isbn13 ?? clean ?? title.trim().toLowerCase()}`,
      title: title.trim(),
      authors: author.trim() ? [author.trim()] : [],
      isbn10: clean?.length === 10 ? clean : undefined,
      isbn13
    };
    try { await onAdd(book, owned); } finally { setBusy(false); }
  }

  return <form className="manual-add" onSubmit={event => void submit(true, event)}>
    <h3>Ajouter à la main</h3>
    {clean && <p className="manual-isbn">ISBN {canonicalIsbn({ isbn13, isbn10: clean.length === 10 ? clean : undefined }) ?? clean}</p>}
    <label>Titre<input value={title} onChange={e => setTitle(e.target.value)} required placeholder="Le chevalier de rubis" /></label>
    <label>Auteur<input value={author} onChange={e => setAuthor(e.target.value)} placeholder="David Eddings" /></label>
    <div className="card-actions">
      <button type="submit" disabled={busy || !title.trim()}>Je le possède</button>
      <button type="button" className="secondary-inline" disabled={busy || !title.trim()} onClick={() => void submit(false)}>Je ne le possède pas</button>
    </div>
  </form>;
}
