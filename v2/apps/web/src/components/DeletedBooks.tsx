import { useState } from "react";
import { displayTitle, groupDeletedByAuthor, plural, RESTORE_WINDOW_DAYS, type DeletedGroup } from "../lib/library-view";
import { listRecentlyDeletedBooks, restoreDeletedBooks, type LibraryBook } from "../services/library";
import { useLibrary } from "../state/LibraryProvider";

const dateFormat = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

/** Livres supprimés ces derniers jours : les voir, les restaurer par auteur ou un par un. */
export function DeletedBooks() {
  const { setLibrary, dbState } = useLibrary();
  const [groups, setGroups] = useState<DeletedGroup[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function load() {
    setBusy(true);
    setMessage("");
    try { setGroups(groupDeletedByAuthor(await listRecentlyDeletedBooks())); }
    catch (x) { setMessage(x instanceof Error ? x.message : "Impossible de lire les livres supprimés."); }
    finally { setBusy(false); }
  }

  async function restore(books: LibraryBook[], label: string) {
    setBusy(true);
    setMessage("");
    try {
      setLibrary(await restoreDeletedBooks(books));
      setGroups(groupDeletedByAuthor(await listRecentlyDeletedBooks()));
      setMessage(`${books.length} ${plural(books.length, "livre")} ${plural(books.length, "restauré")} : ${label}.`);
    } catch (x) {
      setMessage(x instanceof Error ? x.message : "Restauration impossible.");
    } finally {
      setBusy(false);
    }
  }

  const total = groups?.reduce((sum, group) => sum + group.books.length, 0) ?? 0;

  return <div className="settings-section settings-divider">
    <p className="eyebrow">Mes données</p>
    <h2>Livres supprimés</h2>
    <p className="settings-help">
      Un livre supprimé reste restaurable pendant {RESTORE_WINDOW_DAYS} jours. Si la synchronisation est active, la restauration revient aussi sur tes autres appareils.
    </p>
    {groups === null
      ? <div className="credential-actions"><button type="button" disabled={busy || dbState !== "ready"} onClick={() => void load()}>{busy ? "Lecture…" : "Voir les livres supprimés"}</button></div>
      : total === 0
        ? <p className="settings-help" role="status">Aucun livre supprimé ces {RESTORE_WINDOW_DAYS} derniers jours.</p>
        : <div className="deleted-groups">
          {groups.map(group => <details key={group.key} className="deleted-group">
            <summary>
              <span><strong>{group.author}</strong> · {group.books.length} {plural(group.books.length, "livre")}</span>
              <em>supprimé{group.books.length > 1 ? "s" : ""} le {dateFormat.format(new Date(group.deletedAt))}</em>
            </summary>
            <div className="credential-actions">
              <button type="button" disabled={busy} onClick={() => void restore(group.books, group.author)}>Restaurer les {group.books.length} {plural(group.books.length, "livre")}</button>
            </div>
            <ul>{group.books.map(book => <li key={book.id}>
              <span>{displayTitle(book.title)}</span>
              <button type="button" className="text-button" disabled={busy} onClick={() => void restore([book], displayTitle(book.title))}>Restaurer</button>
            </li>)}</ul>
          </details>)}
        </div>}
    {message && <p className="credential-message" role="status">{message}</p>}
  </div>;
}
