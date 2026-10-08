import { Cover } from "../components/Cover";
import { useEffect, useState, type FormEvent } from "react";
import type { ReadingStatus } from "@tsundoku/database";
import { displayAuthors, formatDateTime, localDateTimeValue, statusLabels } from "../lib/library-view";
import { addReadingSession, getReadingSessions, removeBookFromLibrary, updateLibraryBook, type LibraryBook, type ReadingSession } from "../services/library";
import { useLibrary } from "../state/LibraryProvider";
import { useNavigation } from "../state/NavigationProvider";

export function BookDetailScreen({ book }: { book: LibraryBook }) {
  const { setLibrary } = useLibrary();
  const nav = useNavigation();
  const [error, setError] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);

  const [sessions, setSessions] = useState<ReadingSession[]>([]);
  const [sessionDate, setSessionDate] = useState(() => localDateTimeValue());
  const [sessionDuration, setSessionDuration] = useState(30);
  const [sessionEndProgress, setSessionEndProgress] = useState("");
  const [sessionNotes, setSessionNotes] = useState("");
  const [sessionBusy, setSessionBusy] = useState(false);

  useEffect(() => {
    let active = true;
    getReadingSessions(book.id).then(
      value => { if (active) setSessions(value); },
      err => { if (active) setError(err instanceof Error ? err.message : "Impossible de charger les sessions."); }
    );
    return () => { active = false; };
  }, [book.id]);

  async function patch(changes: Parameters<typeof updateLibraryBook>[1]) {
    try { setLibrary(await updateLibraryBook(book.id, changes)); }
    catch (x) { setError(x instanceof Error ? x.message : "Modification impossible."); }
  }

  async function saveSession(e: FormEvent) {
    e.preventDefault();
    if (sessionBusy) return;
    setSessionBusy(true);
    setError("");
    try {
      const result = await addReadingSession(book.id, {
        startedAt: new Date(sessionDate).toISOString(),
        durationMinutes: sessionDuration,
        endProgress: sessionEndProgress.trim() === "" ? undefined : Number(sessionEndProgress),
        notes: sessionNotes
      });
      setLibrary(result.library);
      setSessions(result.sessions);
      setSessionDate(localDateTimeValue());
      setSessionEndProgress("");
      setSessionNotes("");
    } catch (x) {
      setError(x instanceof Error ? x.message : "Impossible d'enregistrer la session.");
    } finally {
      setSessionBusy(false);
    }
  }

  async function remove() {
    if (deleteBusy) return;
    const confirmed = window.confirm(
      `Supprimer « ${book.title} » de votre bibliothèque ?\n\nCette action retirera également son état de lecture et sa progression.`
    );
    if (!confirmed) return;
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

  return <section className="book-detail">
    <button className="secondary" onClick={nav.back}>← Retour</button>
    {error && <p className="error">{error}</p>}
    <div className="detail-layout">
      <div><Cover book={book} variant="detail" /></div>
      <div>
        <p className="eyebrow">{displayAuthors(book.authors)}</p><h2>{book.title}</h2>
        <p>{book.description || "Aucune description disponible."}</p>
        <div className="detail-grid">
          <label>Statut<select value={book.status} onChange={e => void patch({ status: e.target.value as ReadingStatus })}>
            {Object.entries(statusLabels).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select></label>
          <label className="check"><input type="checkbox" checked={book.favorite} onChange={e => void patch({ favorite: e.target.checked })} /> Favori ★</label>
          <label className="check"><input type="checkbox" checked={book.owned} onChange={e => void patch({ owned: e.target.checked })} /> Je possède ce livre</label>
          <label>Progression<input type="number" min="0" value={book.progressValue ?? ""} onChange={e => void patch({ progressValue: e.target.value === "" ? 0 : Number(e.target.value) })} /></label>
          <label>Total<input type="number" min="0" value={book.progressTotal ?? ""} onChange={e => void patch({ progressTotal: e.target.value === "" ? 0 : Number(e.target.value) })} /></label>
        </div>
        <p className="meta">{book.publisher || "Éditeur inconnu"} {book.publishedYear ? `· ${book.publishedYear}` : ""} {book.isbn13 ? `· ISBN ${book.isbn13}` : ""}</p>
        <section className="reading-sessions">
          <div className="session-heading">
            <div><p className="eyebrow">Journal de lecture</p><h3>Sessions de lecture</h3></div>
            <strong>{sessions.reduce((sum, session) => sum + session.durationMinutes, 0)} min</strong>
          </div>
          <form className="session-form" onSubmit={saveSession}>
            <label>Date et heure<input type="datetime-local" required value={sessionDate} onChange={e => setSessionDate(e.target.value)} /></label>
            <label>Durée (min)<input type="number" min="1" required value={sessionDuration} onChange={e => setSessionDuration(Number(e.target.value))} /></label>
            <label>Page / progression après la session<input type="number" min="0" max={book.progressTotal} placeholder={book.progressValue != null ? String(book.progressValue) : "Optionnel"} value={sessionEndProgress} onChange={e => setSessionEndProgress(e.target.value)} /></label>
            <label className="session-notes">Notes<input type="text" placeholder="Optionnel" value={sessionNotes} onChange={e => setSessionNotes(e.target.value)} /></label>
            <button disabled={sessionBusy}>{sessionBusy ? "Enregistrement…" : "Enregistrer la session"}</button>
          </form>
          {sessions.length > 0 ? <div className="session-list">
            {sessions.map(session => <article key={session.id}>
              <div><strong>{formatDateTime(session.startedAt)}</strong><small>{session.durationMinutes} min{session.endProgress != null ? ` · progression ${session.endProgress}${book.progressTotal ? `/${book.progressTotal}` : ""}` : ""}</small></div>
              {session.notes && <p>{session.notes}</p>}
            </article>)}
          </div> : <p className="meta">Aucune session enregistrée pour ce livre.</p>}
        </section>
        <div className="danger-zone">
          <div>
            <strong>Supprimer de ma bibliothèque</strong>
            <p>Retire ce livre, son statut et sa progression de ta bibliothèque.</p>
          </div>
          <button type="button" className="danger-button" disabled={deleteBusy} onClick={() => void remove()}>
            {deleteBusy ? "Suppression…" : "Supprimer"}
          </button>
        </div>
      </div>
    </div>
  </section>;
}
