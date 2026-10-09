import { useEffect, useRef } from "react";
import { runSync } from "../services/sync";
import type { LibraryBook } from "../services/library";

const MIN_INTERVAL = 60 * 1000;
/** Tant que l'application est ouverte et visible, on va chercher ce que les autres appareils ont modifié. */
const POLL_INTERVAL = 2 * 60 * 1000;

/**
 * Synchronise au lancement, quand l'application revient au premier plan, quand elle le quitte
 * (pour que les dernières modifications partent) et toutes les 2 minutes tant qu'elle est visible.
 * Au plus une fois par minute.
 */
export function useAutoSync(ready: boolean, setLibrary: (library: LibraryBook[]) => void): void {
  const lastRun = useRef(0);
  useEffect(() => {
    if (!ready) return;
    const sync = (force = false) => {
      if (!force && Date.now() - lastRun.current < MIN_INTERVAL) return;
      lastRun.current = Date.now();
      void runSync().then(library => { if (library) setLibrary(library); });
    };
    sync(true);
    const onVisibility = () => sync();
    document.addEventListener("visibilitychange", onVisibility);
    const poll = window.setInterval(() => { if (document.visibilityState === "visible") sync(); }, POLL_INTERVAL);
    return () => { document.removeEventListener("visibilitychange", onVisibility); window.clearInterval(poll); };
  }, [ready, setLibrary]);
}
