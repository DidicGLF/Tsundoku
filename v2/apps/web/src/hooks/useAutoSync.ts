import { useEffect, useRef } from "react";
import { latestUpdate } from "../lib/library-view";
import { runSync } from "../services/sync";
import type { LibraryBook } from "../services/library";

/** Écart minimal entre deux synchronisations lancées automatiquement. */
const MIN_INTERVAL = 10 * 1000;
/** Tant que l'application est ouverte et visible, on va chercher ce que les autres appareils ont modifié. */
const POLL_INTERVAL = 30 * 1000;
/** Une modification locale part au bout de ce délai (plusieurs gestes d'affilée ne font qu'un envoi). */
const CHANGE_DELAY = 4 * 1000;

/**
 * Synchronise au lancement, quand l'application revient au premier plan ou le quitte, quand le réseau revient,
 * peu après chaque modification locale, et toutes les 30 secondes tant qu'elle est visible.
 */
export function useAutoSync(ready: boolean, library: LibraryBook[], setLibrary: (library: LibraryBook[]) => void): void {
  const lastRun = useRef(0);
  /** Dernière modification connue au moment de la dernière synchronisation : sert à repérer les modifications locales. */
  const syncedUpTo = useRef("");
  /** Nombre de fiches à la dernière synchronisation : une suppression ne change aucune date, seulement ce nombre. */
  const syncedCount = useRef<number | null>(null);
  const changeTimer = useRef<number | undefined>(undefined);
  const syncRef = useRef<(force?: boolean) => void>(() => undefined);

  useEffect(() => {
    if (!ready) return;
    const sync = (force = false) => {
      if (!force && Date.now() - lastRun.current < MIN_INTERVAL) return;
      lastRun.current = Date.now();
      void runSync().then(updated => {
        if (!updated) return;
        syncedUpTo.current = latestUpdate(updated);
        syncedCount.current = updated.length;
        setLibrary(updated);
      });
    };
    syncRef.current = sync;
    sync(true);
    const onVisibility = () => sync();
    const onOnline = () => sync(true);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    const poll = window.setInterval(() => { if (document.visibilityState === "visible") sync(); }, POLL_INTERVAL);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
      window.clearInterval(poll);
    };
  }, [ready, setLibrary]);

  // Une fiche plus récente que la dernière synchronisation, ou des fiches en moins = modification locale : envoi différé.
  useEffect(() => {
    if (!ready) return;
    const latest = latestUpdate(library);
    if (syncedCount.current === null) syncedCount.current = library.length;
    if (!syncedUpTo.current) { syncedUpTo.current = latest; return; }
    const deletedLocally = library.length < syncedCount.current;
    if (latest <= syncedUpTo.current && !deletedLocally) return;
    window.clearTimeout(changeTimer.current);
    changeTimer.current = window.setTimeout(() => syncRef.current(true), CHANGE_DELAY);
    return () => window.clearTimeout(changeTimer.current);
  }, [ready, library]);
}
