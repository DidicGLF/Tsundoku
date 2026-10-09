import { useEffect, useState, type FormEvent } from "react";
import type { BookSearchLanguage } from "../services/bookSearch";
import { deleteGoogleBooksApiKey, hasGoogleBooksApiKey, saveGoogleBooksApiKey } from "../services/credentials";
import { exportBackup, lastBackupAt, previewImport } from "../services/backup";
import { plural } from "../lib/library-view";
import { DangerZone } from "../components/DangerZone";
import { DeletedBooks } from "../components/DeletedBooks";
import { InstallApp } from "../components/InstallApp";
import { SyncSettings } from "../components/SyncSettings";
import { useLibrary } from "../state/LibraryProvider";
import { usePreferences } from "../state/PreferencesProvider";

export function SettingsScreen() {
  const { preferredLanguage, setPreferredLanguage } = usePreferences();
  const [googleKey, setGoogleKey] = useState("");
  const [configured, setConfigured] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const { library, setLibrary, dbState } = useLibrary();
  const [backupMessage, setBackupMessage] = useState("");
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupAt, setBackupAt] = useState(lastBackupAt());

  useEffect(() => {
    void hasGoogleBooksApiKey().then(setConfigured).catch(err => console.error("Credential storage initialization failed:", err));
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      await saveGoogleBooksApiKey(googleKey);
      setGoogleKey("");
      setConfigured(true);
      setMessage("Clé Google Books enregistrée.");
    } catch (x) {
      setMessage(x instanceof Error ? x.message : "Impossible d'enregistrer la clé.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setMessage("");
    try {
      await deleteGoogleBooksApiKey();
      setGoogleKey("");
      setConfigured(false);
      setMessage("Clé Google Books supprimée.");
    } catch (x) {
      setMessage(x instanceof Error ? x.message : "Impossible de supprimer la clé.");
    } finally {
      setBusy(false);
    }
  }

  async function doExport() {
    setBackupBusy(true);
    setBackupMessage("");
    try {
      const { count } = await exportBackup();
      setBackupAt(lastBackupAt());
      setBackupMessage(`Sauvegarde prête : ${count} ${plural(count, "livre")}.`);
    } catch (x) {
      setBackupMessage(x instanceof Error ? x.message : "Impossible de créer la sauvegarde.");
    } finally {
      setBackupBusy(false);
    }
  }

  async function doImport(file: File | undefined) {
    if (!file) return;
    setBackupBusy(true);
    setBackupMessage("");
    try {
      const preview = await previewImport(file, library);
      if (!preview.added && !preview.merged) { setBackupMessage("Rien à importer : ta bibliothèque contient déjà tout."); return; }
      const ok = window.confirm(`Importer cette sauvegarde ?\n\n• ${preview.added} ${plural(preview.added, "livre")} ${plural(preview.added, "ajouté", "ajoutés")}\n• ${preview.merged} ${plural(preview.merged, "livre")} ${plural(preview.merged, "complété", "complétés")}\n\nRien n'est supprimé ni écrasé.`);
      if (!ok) return;
      const report = await preview.apply();
      setLibrary(report.library);
      setBackupMessage(`Import terminé : ${report.added} ${plural(report.added, "ajouté", "ajoutés")}, ${report.merged} ${plural(report.merged, "complété", "complétés")}.`);
    } catch (x) {
      setBackupMessage(x instanceof Error ? x.message : "Import impossible.");
    } finally {
      setBackupBusy(false);
    }
  }

  return <section className="settings-card">
    <InstallApp />
    <SyncSettings />
    <div className="settings-section settings-divider">
      <p className="eyebrow">Mes données</p>
      <h2>Sauvegarde</h2>
      <p className="settings-help">
        Sur Android, la base de Tsundoku est sauvegardée automatiquement avec les sauvegardes de ton téléphone (compte Google), sans rien faire.
        Pour une copie à toi, ou pour changer de téléphone, exporte un fichier : tu peux l'enregistrer dans Drive ou te l'envoyer.
      </p>
      <p className="settings-help">{backupAt ? `Dernier export : ${new Date(backupAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}.` : "Aucun export pour l'instant."}</p>
      <div className="credential-actions">
        <button type="button" disabled={backupBusy || dbState !== "ready" || library.length === 0} onClick={() => void doExport()}>Exporter ma bibliothèque</button>
        <label className="file-button secondary-file">
          Importer une sauvegarde
          <input type="file" accept="application/json,.json" hidden disabled={backupBusy || dbState !== "ready"}
            onChange={event => { void doImport(event.target.files?.[0]); event.target.value = ""; }} />
        </label>
      </div>
      {backupMessage && <p className="credential-message" role="status">{backupMessage}</p>}
    </div>
    <DeletedBooks />
    <div className="settings-section settings-divider">
      <p className="eyebrow">Recherche de livres</p>
      <h2>Langue préférée</h2>
      <p className="settings-help">La langue sert à classer les résultats, pas à les supprimer. En français, Tsundoku combine la BnF, Open Library et Google Books.</p>
      <label className="language-setting">Langue des résultats
        <select value={preferredLanguage} onChange={e => { setPreferredLanguage(e.target.value as BookSearchLanguage); setMessage("Langue préférée enregistrée."); }}>
          <option value="fr">Français</option>
          <option value="en">Anglais</option>
          <option value="de">Allemand</option>
          <option value="es">Espagnol</option>
          <option value="it">Italien</option>
          <option value="all">Toutes les langues</option>
        </select>
      </label>
    </div>
    <div className="settings-section settings-divider">
      <div className="settings-heading">
        <div>
          <p className="eyebrow">Sources de livres</p>
          <h2>Google Books</h2>
        </div>
        <span className={configured ? "credential-status configured" : "credential-status"}>
          {configured ? "● Clé configurée" : "○ Aucune clé"}
        </span>
      </div>
      <p className="settings-help">
        La clé est propre à cet appareil. Elle n'est enregistrée ni dans SQLite, ni dans les données synchronisables.
        Sur Android, elle est conservée dans le stockage sécurisé du système.
      </p>
      <p className="settings-help">
        Sans clé, les jaquettes viennent surtout d'Open Library et beaucoup d'éditions françaises n'en ont pas.
        Une clé gratuite s'obtient dans la console Google Cloud : activer « Books API », puis Identifiants → Créer une clé API.
      </p>
      <form className="credential-form" onSubmit={save}>
        <label>
          {configured ? "Remplacer la clé API" : "Clé API Google Books"}
          <input type="password" autoComplete="off" value={googleKey} onChange={e => setGoogleKey(e.target.value)}
            placeholder={configured ? "Saisir une nouvelle clé…" : "Saisir la clé…"} />
        </label>
        <div className="credential-actions">
          <button disabled={busy || !googleKey.trim()}>{busy ? "Enregistrement…" : configured ? "Remplacer" : "Enregistrer"}</button>
          {configured && <button type="button" className="danger-button" disabled={busy} onClick={() => void remove()}>Supprimer la clé</button>}
        </div>
      </form>
      {message && <p className="credential-message">{message}</p>}
    </div>
    <DangerZone />
  </section>;
}
