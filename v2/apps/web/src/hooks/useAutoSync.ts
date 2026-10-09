import { useEffect, useRef } from "react";
import { runSync } from "../services/sync";
import type { LibraryBook } from "../services/library";

const MIN_INTERVAL = 60 * 1000;

/**
 * Synchronise au lancement, quand l'application revient au premier plan et quand elle le quitte
 * (pour que les dernières modifications partent). Au plus une fois par minute.
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
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [ready, setLibrary]);
}
