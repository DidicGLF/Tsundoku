import { createContext, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from "react";
import { Capacitor } from "@capacitor/core";
import { App as CapacitorApp } from "@capacitor/app";
import { canGoBack, currentRoute, initialNavState, navReducer, type Route } from "./navigation";

interface Navigation {
  route: Route;
  /** Incrémenté à chaque appui sur un onglet (jamais par un retour arrière). */
  tabPresses: number;
  /** Onglet de premier niveau : repart de l'accueil. */
  reset(route: Route): void;
  push(route: Route): void;
  back(): void;
}

const NavigationContext = createContext<Navigation | null>(null);

export function NavigationProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(navReducer, initialNavState);
  const stateRef = useRef(state);
  stateRef.current = state;

  // Bouton retour Android : le gestionnaire est installé une fois et lit l'état courant via la ref.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const listener = CapacitorApp.addListener("backButton", () => {
      if (canGoBack(stateRef.current)) dispatch({ type: "back" });
      else void CapacitorApp.exitApp();
    });
    return () => { void listener.then(handle => handle.remove()); };
  }, []);

  const value = useMemo<Navigation>(() => ({
    route: currentRoute(state),
    tabPresses: state.tabPresses,
    reset: route => dispatch({ type: "reset", route }),
    push: route => dispatch({ type: "push", route }),
    back: () => dispatch({ type: "back" })
  }), [state]);

  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}

export function useNavigation(): Navigation {
  const value = useContext(NavigationContext);
  if (!value) throw new Error("useNavigation doit être utilisé dans un NavigationProvider.");
  return value;
}
