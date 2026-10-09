import { Capacitor } from "@capacitor/core";
import { useEffect, useState } from "react";

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const isStandalone = () =>
  window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

/** Installation de la version web : le bouton du navigateur quand il existe, sinon la marche à suivre sur iPhone. Rien sur Android (c'est déjà l'app) ni une fois installée. */
export function InstallApp() {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const onPrompt = (event: Event) => { event.preventDefault(); setPrompt(event as InstallPromptEvent); };
    const onInstalled = () => { setInstalled(true); setPrompt(null); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => { window.removeEventListener("beforeinstallprompt", onPrompt); window.removeEventListener("appinstalled", onInstalled); };
  }, []);

  if (Capacitor.isNativePlatform() || isStandalone() || installed) return null;
  if (!prompt && !isIos()) return null;

  return <div className="settings-section settings-divider">
    <p className="eyebrow">Cet appareil</p>
    <h2>Installer l'application</h2>
    {prompt
      ? <>
        <p className="settings-help">Ajoute Tsundoku à ton menu Démarrer ou à ton écran d'accueil : elle s'ouvre dans sa propre fenêtre et fonctionne sans connexion.</p>
        <div className="credential-actions"><button type="button" onClick={() => void prompt.prompt()}>Installer Tsundoku</button></div>
      </>
      : <p className="settings-help">Sur iPhone et iPad : appuie sur le bouton Partager de Safari, puis sur « Sur l'écran d'accueil ».</p>}
  </div>;
}
