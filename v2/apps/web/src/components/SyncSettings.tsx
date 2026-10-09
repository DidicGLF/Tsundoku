import { useEffect, useState, useSyncExternalStore, type FormEvent } from "react";
import { plural } from "../lib/library-view";
import { canScanBarcode, scanQrText } from "../services/barcodeScanner";
import {
  createPairingCode, currentLibraryFingerprint, DEFAULT_SERVER_URL, deleteServerData, disableSync, enableSync, getSyncConfig, getSyncKey, getSyncStatus, isSyncEnabled,
  joinSync, runSync, serverUrl, subscribeSync
} from "../services/sync";
import { useLibrary } from "../state/LibraryProvider";
import { QrCode } from "./QrCode";

/** Réglage de la synchronisation : activer en un geste, lier un autre appareil par QR code ou par la clé. */
export function SyncSettings() {
  const { setLibrary, dbState } = useLibrary();
  const status = useSyncExternalStore(subscribeSync, getSyncStatus);
  const [enabled, setEnabled] = useState(isSyncEnabled());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [mode, setMode] = useState<"home" | "join" | "share">("home");
  const [key, setKey] = useState("");
  const [pairing, setPairing] = useState<{ code: string; expiresAt: number } | null>(null);
  const [now, setNow] = useState(Date.now());
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const [joinKey, setJoinKey] = useState("");
  const [advancedUrl, setAdvancedUrl] = useState("");
  const hasServer = Boolean(serverUrl());

  useEffect(() => {
    void getSyncConfig().then(config => setEnabled(Boolean(config)), () => undefined);
    void currentLibraryFingerprint().then(setFingerprint, () => undefined);
  }, []);

  // Compte à rebours du code de liaison.
  useEffect(() => {
    if (!pairing) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [pairing]);

  async function activate(joinInput?: string) {
    setBusy(true);
    setMessage("");
    try {
      if (joinInput !== undefined) await joinSync(joinInput, advancedUrl || undefined);
      else await enableSync({ customUrl: advancedUrl || undefined });
      setEnabled(true);
      setFingerprint(await currentLibraryFingerprint());
      setMode("home");
      setJoinKey("");
      setMessage("Synchronisation activée. Première synchronisation…");
      const updated = await runSync({ manual: true });
      if (updated) setLibrary(updated);
      setMessage("");
    } catch (x) {
      setMessage(x instanceof Error ? x.message : "Activation impossible.");
    } finally {
      setBusy(false);
    }
  }

  function confirmThenActivate() {
    const ok = window.confirm(
      "Activer la synchronisation ?\n\nTa bibliothèque (livres, statuts, notes, favoris, auteurs suivis) sera copiée sur le serveur de Tsundoku, " +
      "associée à une clé secrète propre à toi, sans nom ni adresse e-mail. Tu pourras tout effacer du serveur à tout moment depuis cet écran."
    );
    if (ok) void activate();
  }

  async function scanKey() {
    setMessage("");
    try {
      const text = await scanQrText();
      if (text) setJoinKey(text);
    } catch (x) {
      setMessage(x instanceof Error ? x.message : "Le scan a échoué.");
    }
  }

  async function showPairing() {
    setBusy(true);
    setMessage("");
    try {
      setKey((await getSyncKey()) ?? "");
      setPairing(await createPairingCode());
      setNow(Date.now());
      setMode("share");
    } catch (x) {
      setMessage(x instanceof Error ? x.message : "Impossible de créer un code de liaison.");
    } finally {
      setBusy(false);
    }
  }

  const secondsLeft = pairing ? Math.max(0, Math.round((pairing.expiresAt - now) / 1000)) : 0;

  async function syncNow() {
    setBusy(true);
    setMessage("");
    try {
      const updated = await runSync({ manual: true });
      if (updated) setLibrary(updated);
    } finally {
      setBusy(false);
    }
  }

  function stop() {
    if (!window.confirm("Arrêter la synchronisation sur cet appareil ?\n\nTes livres restent ici et sur le serveur. Tu pourras la réactiver avec la même clé.")) return;
    disableSync();
    setEnabled(false);
    setMode("home");
    setMessage("Synchronisation arrêtée sur cet appareil.");
  }

  async function erase() {
    if (!window.confirm("Effacer ta bibliothèque du serveur ?\n\nLes livres restent sur tes appareils, mais ils ne se synchroniseront plus. Cette action est définitive.")) return;
    setBusy(true);
    setMessage("");
    try {
      await deleteServerData();
      setEnabled(false);
      setMode("home");
      setMessage("Tes données ont été effacées du serveur.");
    } catch (x) {
      setMessage(x instanceof Error ? x.message : "Effacement impossible.");
    } finally {
      setBusy(false);
    }
  }

  const summary = status.state === "running" ? "Synchronisation en cours…"
    : status.state === "error" ? `Dernière tentative échouée : ${status.error}`
    : status.at ? `Dernière synchronisation : ${new Date(status.at).toLocaleString("fr-FR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}${
        status.report ? ` (${status.report.pushed} ${plural(status.report.pushed, "envoyé")}, ${status.report.received} ${plural(status.report.received, "reçu")})` : ""}.`
    : "Pas encore synchronisé.";

  return <div className="settings-section">
    <div className="settings-heading">
      <div>
        <p className="eyebrow">Mes appareils</p>
        <h2>Synchronisation</h2>
      </div>
      <span className={enabled ? "credential-status configured" : "credential-status"}>{enabled ? "● Activée" : "○ Désactivée"}</span>
    </div>
    <p className="settings-help">
      Retrouve la même bibliothèque sur ton téléphone et ton ordinateur : statuts, notes, favoris, auteurs suivis. Chaque appareil garde sa copie complète et fonctionne hors ligne.
    </p>

    {!enabled && mode === "home" && <div className="credential-actions">
      <button type="button" disabled={busy || dbState !== "ready" || !hasServer && !advancedUrl.trim()} onClick={confirmThenActivate}>Activer la synchronisation</button>
      <button type="button" className="secondary-inline" disabled={busy} onClick={() => setMode("join")}>J'ai déjà une clé</button>
    </div>}

    {!enabled && mode === "join" && <form className="credential-form" onSubmit={(e: FormEvent) => { e.preventDefault(); void activate(joinKey); }}>
      <p className="settings-help">Sur l'autre appareil : Paramètres → Synchronisation → « Lier un autre appareil ». Tape le code de liaison affiché (par exemple K7M4-QX2R) ou scanne son QR code.</p>
      <label>Code de liaison
        <input className="pairing-input" autoComplete="off" autoCapitalize="characters" spellCheck={false} value={joinKey} onChange={e => setJoinKey(e.target.value)} placeholder="K7M4-QX2R" />
      </label>
      <div className="credential-actions">
        <button disabled={busy || dbState !== "ready" || !joinKey.trim()}>{busy ? "Connexion…" : "Rejoindre"}</button>
        {canScanBarcode() && <button type="button" className="secondary-inline" disabled={busy} onClick={() => void scanKey()}>Scanner le QR code</button>}
        <button type="button" className="secondary-inline" disabled={busy} onClick={() => { setMode("home"); setJoinKey(""); }}>Retour</button>
      </div>
    </form>}

    {enabled && mode === "home" && <>
      <p className="settings-help" role="status">{summary}</p>
      {fingerprint && <p className="settings-help">Bibliothèque {fingerprint}{status.serverEntries != null ? ` · ${status.serverEntries} ${plural(status.serverEntries, "livre")} sur le serveur` : ""}. Le même identifiant doit s'afficher sur tous tes appareils.</p>}
      <div className="credential-actions">
        <button type="button" disabled={busy || dbState !== "ready"} onClick={() => void syncNow()}>Synchroniser maintenant</button>
        <button type="button" className="secondary-inline" disabled={busy} onClick={() => void showPairing()}>Lier un autre appareil</button>
      </div>
    </>}

    {enabled && mode === "share" && pairing && <div className="sync-share">
      <p className="settings-help">Sur l'autre appareil, choisis « J'ai déjà une clé » et tape ce code :</p>
      <p className="pairing-code" aria-live="polite">{secondsLeft > 0 ? pairing.code : "Code expiré"}</p>
      <p className="settings-help">{secondsLeft > 0
        ? `Valable encore ${Math.floor(secondsLeft / 60)} min ${String(secondsLeft % 60).padStart(2, "0")} s, utilisable une seule fois.`
        : "Demande un nouveau code."}</p>
      <div className="credential-actions">
        <button type="button" disabled={busy} onClick={() => void showPairing()}>Nouveau code</button>
        <button type="button" className="secondary-inline" onClick={() => { setMode("home"); setKey(""); setPairing(null); }}>Fermer</button>
      </div>
      <details className="sync-advanced">
        <summary>Autre méthode : QR code ou clé</summary>
        <p className="settings-help">Cette clé donne accès à ta bibliothèque, ne la partage qu'avec toi-même.</p>
        {key && <QrCode value={key} />}
        <code className="sync-key">{key}</code>
        <button type="button" className="secondary-inline" onClick={() => void navigator.clipboard?.writeText(key).then(() => setMessage("Clé copiée."), () => setMessage("Copie impossible : recopie-la à la main."))}>Copier la clé</button>
      </details>
    </div>}

    {enabled && mode === "home" && <details className="sync-advanced">
      <summary>Options</summary>
      <div className="credential-actions">
        <button type="button" className="secondary-inline" disabled={busy} onClick={stop}>Arrêter sur cet appareil</button>
        <button type="button" className="danger-button" disabled={busy} onClick={() => void erase()}>Effacer mes données du serveur</button>
      </div>
    </details>}

    {!enabled && mode === "home" && (!DEFAULT_SERVER_URL || advancedUrl) && <label className="sync-advanced">Adresse du serveur
      <input type="url" inputMode="url" autoComplete="off" autoCapitalize="off" value={advancedUrl} onChange={e => setAdvancedUrl(e.target.value)} placeholder="https://tsundoku.mon-reseau.ts.net" />
    </label>}
    {message && <p className="credential-message" role="status">{message}</p>}
  </div>;
}
