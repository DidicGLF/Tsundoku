import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { BookSearchLanguage } from "../services/bookSearch";
import { getPreferredBookLanguage, setPreferredBookLanguage } from "../services/preferences";

interface Preferences {
  preferredLanguage: BookSearchLanguage;
  setPreferredLanguage(language: BookSearchLanguage): void;
}

const PreferencesContext = createContext<Preferences | null>(null);

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [preferredLanguage, setLanguage] = useState<BookSearchLanguage>(() => getPreferredBookLanguage());
  const setPreferredLanguage = useCallback((language: BookSearchLanguage) => {
    setLanguage(language);
    setPreferredBookLanguage(language);
  }, []);
  const value = useMemo(() => ({ preferredLanguage, setPreferredLanguage }), [preferredLanguage, setPreferredLanguage]);
  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): Preferences {
  const value = useContext(PreferencesContext);
  if (!value) throw new Error("usePreferences doit être utilisé dans un PreferencesProvider.");
  return value;
}
