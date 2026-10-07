export type Route =
  | { name: "home" }
  | { name: "library" }
  | { name: "add" }
  | { name: "settings" }
  | { name: "author"; key: string; authorName: string }
  | { name: "detail"; id: string };

export interface NavState { stack: Route[] }

export type NavAction =
  | { type: "push"; route: Route }
  | { type: "reset"; route: Route }
  | { type: "back" };

export const initialNavState: NavState = { stack: [{ name: "home" }] };

export function currentRoute(state: NavState): Route {
  return state.stack[state.stack.length - 1];
}

export function canGoBack(state: NavState): boolean {
  return state.stack.length > 1;
}

/**
 * Pile de navigation : « reset » sert aux onglets (Accueil est toujours la racine),
 * « push » ouvre un écran enfant, « back » revient à l'écran précédent.
 */
export function navReducer(state: NavState, action: NavAction): NavState {
  switch (action.type) {
    case "reset":
      return { stack: action.route.name === "home" ? [action.route] : [{ name: "home" }, action.route] };
    case "push":
      return { stack: [...state.stack, action.route] };
    case "back":
      return canGoBack(state) ? { stack: state.stack.slice(0, -1) } : state;
  }
}
