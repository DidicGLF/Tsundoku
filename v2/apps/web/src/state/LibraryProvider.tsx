import { createContext, useContext, useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { scheduleLaunchCoverPass } from "../services/coverPass";
import { usePreferences } from "./PreferencesProvider";
import { initializeLibrary, type LibraryBook } from "../services/library";

interface LibraryState {
  library: LibraryBook[];
  setLibrary: Dispatch<SetStateAction<LibraryBook[]>>;
  dbState: "loading" | "ready" | "error";
  dbError: string;
}

const LibraryContext = createContext<LibraryState | null>(null);

export function LibraryProvider({ children }: { children: ReactNode }) {
  const [library, setLibrary] = useState<LibraryBook[]>([]);
  const [dbState, setDbState] = useState<LibraryState["dbState"]>("loading");
  const [dbError, setDbError] = useState("");

  useEffect(() => {
    let active = true;
    initializeLibrary().then(
      books => { if (active) { setLibrary(books); setDbState("ready"); } },
      err => {
        if (!active) return;
        console.error("Tsundoku SQLite initialization failed:", err);
        setDbError(err instanceof Error ? err.message : String(err));
        setDbState("error");
      }
    );
    return () => { active = false; };
  }, []);

  // Une fois par lancement, quand la bibliothèque est prête : jaquettes manquantes, en arrière-plan.
  const { preferredLanguage } = usePreferences();
  const initialBooks = useRef<LibraryBook[] | null>(null);
  if (dbState === "ready" && initialBooks.current === null) initialBooks.current = library;
  useEffect(() => {
    if (dbState !== "ready" || !initialBooks.current) return;
    return scheduleLaunchCoverPass(initialBooks.current, preferredLanguage, setLibrary);
  }, [dbState, preferredLanguage]);

  const value = useMemo(() => ({ library, setLibrary, dbState, dbError }), [library, dbState, dbError]);
  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}

export function useLibrary(): LibraryState {
  const value = useContext(LibraryContext);
  if (!value) throw new Error("useLibrary doit être utilisé dans un LibraryProvider.");
  return value;
}
