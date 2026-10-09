import { useState } from "react";
import { deletionNotice, plural, RESTORE_WINDOW_DAYS } from "../lib/library-view";
import { deleteWholeLibrary } from "../services/library";
import { isSyncEnabled } from "../services/sync";
import { useLibrary } from "../state/LibraryProvider";

const WORD = "SUPPRIMER";

/** Suppression de toute la bibliothèque : confirmation en deux temps (il faut retaper un mot), restaurable ensuite. */
export function DangerZone() {
  const { library, setLibrary, dbState } = useLibrary();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function confirm() {
    setBusy(true);
    setMessage("");
    try {
      const removed = await deleteWholeLibrary();
      setLibrary([]);
      setOpen(false);
      setTyped("");
      setMessage(`${removed} ${plural(removed, "livre")} ${plural(removed, "supprimé")}. Tu peux les restaurer pendant ${RESTORE_WINDOW_DAYS} jours dans « Livres supprimés ».`);
    } catch (x) {
      setMessage(x instanceof Error ? x.message : "Suppression impossible.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="settings-section settings-divider danger-zone">
    <p className="eyebrow">Zone dangereuse</p>
    <h2>Supprimer toute ma bibliothèque</h2>
    {!open
      ? <>
        <p className="settings-help">Retire tous les livres et tous les auteurs suivis de cet appareil.</p>
        <div className="credential-actions">
          <button type="button" className="danger-button" disabled={dbState !== "ready" || library.length === 0} onClick={() => setOpen(true)}>Supprimer toute ma bibliothèque…</button>
        </div>
      </>
      : <form className="credential-form" onSubmit={e => { e.preventDefault(); if (typed.trim().toUpperCase() === WORD) void confirm(); }}>
        <p className="settings-help danger-text">
          Tu vas supprimer {library.length} {plural(library.length, "livre")} avec leurs statuts, notes et auteurs suivis.
          {deletionNotice(isSyncEnabled()).replace(/^\n\n/, " ").replace(/\n\n/g, " ")}
        </p>
        <label>Pour confirmer, tape {WORD}
          <input autoComplete="off" autoCapitalize="characters" spellCheck={false} value={typed} onChange={e => setTyped(e.target.value)} placeholder={WORD} />
        </label>
        <div className="credential-actions">
          <button className="danger-button" disabled={busy || typed.trim().toUpperCase() !== WORD}>{busy ? "Suppression…" : "Tout supprimer"}</button>
          <button type="button" className="secondary-inline" disabled={busy} onClick={() => { setOpen(false); setTyped(""); }}>Annuler</button>
        </div>
      </form>}
    {message && <p className="credential-message" role="status">{message}</p>}
  </div>;
}
