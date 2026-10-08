import { useEffect, useState, type FormEvent } from "react";
import type { BookSearchLanguage } from "../services/bookSearch";
import { deleteGoogleBooksApiKey, hasGoogleBooksApiKey, saveGoogleBooksApiKey } from "../services/credentials";
import { usePreferences } from "../state/PreferencesProvider";

export function SettingsScreen() {
  const { preferredLanguage, setPreferredLanguage } = usePreferences();
  const [googleKey, setGoogleKey] = useState("");
  const [configured, setConfigured] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

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

  return <section className="settings-card">
    <div className="settings-section">
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
  </section>;
}
