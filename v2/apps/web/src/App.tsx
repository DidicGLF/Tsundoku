import { useBookSearch } from "./hooks/useBookSearch";
import { useLibraryFilters } from "./hooks/useLibraryFilters";
import { AuthorScreen } from "./screens/AuthorScreen";
import { BookDetailScreen } from "./screens/BookDetailScreen";
import { HomeScreen } from "./screens/HomeScreen";
import { LibraryScreen } from "./screens/LibraryScreen";
import { SearchScreen } from "./screens/SearchScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { LibraryProvider, useLibrary } from "./state/LibraryProvider";
import { NavigationProvider, useNavigation } from "./state/NavigationProvider";
import { PreferencesProvider } from "./state/PreferencesProvider";
import "./styles.css";

export default function App() {
  return <PreferencesProvider>
    <LibraryProvider>
      <NavigationProvider>
        <Shell />
      </NavigationProvider>
    </LibraryProvider>
  </PreferencesProvider>;
}

function Shell() {
  const { library, dbState, dbError } = useLibrary();
  const nav = useNavigation();
  // Ces états survivent à la navigation : on retrouve sa recherche et ses filtres en revenant.
  const filters = useLibraryFilters();
  const search = useBookSearch();

  const { route } = nav;
  const book = route.name === "detail" ? library.find(b => b.id === route.id) : undefined;

  const title =
    route.name === "home" ? "Bonjour 👋" :
    route.name === "library" ? "Ma bibliothèque" :
    route.name === "add" ? "Rechercher" :
    route.name === "settings" ? "Paramètres" :
    route.name === "author" ? route.authorName || "Bibliographie" :
    book?.title ?? "Livre";

  return <div className="shell">
    <aside>
      <div className="brand"><img src="/logo.png" alt="" width="40" height="40" /><b>Tsundoku</b></div>
      <nav>
        <button onClick={() => nav.reset({ name: "home" })}>Accueil</button>
        <button onClick={() => nav.reset({ name: "library" })}>Bibliothèque</button>
        <button onClick={() => nav.reset({ name: "add" })}>Ajouter</button>
        <button onClick={() => nav.reset({ name: "settings" })}>Paramètres</button>
      </nav>
      <span>{dbState === "loading" && "◌ Initialisation SQLite…"}{dbState === "ready" && "● SQLite local"}{dbState === "error" && "⚠ SQLite indisponible"}</span>
    </aside>

    <main>
      <header>Tsundoku V2<h1>{title}</h1></header>

      {dbState === "error" && <section className="hero"><h2>SQLite n'a pas pu démarrer</h2><p className="error">{dbError}</p></section>}

      {route.name === "home" && <HomeScreen filters={filters} />}
      {route.name === "library" && <LibraryScreen filters={filters} />}
      {route.name === "add" && <SearchScreen search={search} />}
      {route.name === "settings" && <SettingsScreen />}
      {/* key : changer d'auteur repart d'un état propre (filtres, messages). */}
      {route.name === "author" && <AuthorScreen key={route.key} authorKey={route.key} authorName={route.authorName} />}
      {route.name === "detail" && book && <BookDetailScreen key={book.id} book={book} />}
    </main>
  </div>;
}
