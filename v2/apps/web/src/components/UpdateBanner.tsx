import { useEffect, useState } from "react";
import { APK_URL, checkForUpdate, dismissUpdate, knownUpdate, type AvailableUpdate } from "../services/updateCheck";

/** Bandeau « nouvelle version disponible » (application Android seulement). */
export function UpdateBanner() {
  const [update, setUpdate] = useState<AvailableUpdate | null>(() => knownUpdate());

  useEffect(() => {
    let active = true;
    void checkForUpdate().then(found => { if (active) setUpdate(found); }, () => undefined);
    return () => { active = false; };
  }, []);

  if (!update) return null;
  return <section className="backup-nudge" role="status">
    <p>Une nouvelle version de Tsundoku est disponible : {update.version}.</p>
    <div>
      <a className="button-link" href={APK_URL} target="_blank" rel="noreferrer">Télécharger</a>
      <button type="button" className="text-button" onClick={() => { dismissUpdate(update.version); setUpdate(null); }}>Plus tard</button>
    </div>
  </section>;
}
