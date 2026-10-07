import { countStatus, type LibraryFilter } from "../lib/library-view";
import { useLibrary } from "../state/LibraryProvider";
import { useNavigation } from "../state/NavigationProvider";
import type { LibraryFilters } from "../hooks/useLibraryFilters";

export function HomeScreen({ filters }: { filters: LibraryFilters }) {
  const { library, dbState } = useLibrary();
  const nav = useNavigation();

  const openLibrary = (filter: LibraryFilter) => { filters.setFilter(filter); nav.reset({ name: "library" }); };
  const stat = (filter: LibraryFilter, label: string, count: number) =>
    <button onClick={() => openLibrary(filter)}><strong>{count}</strong><span>{label}</span></button>;

  return <>
    <section className="hero">
      <h2>Ta bibliothèque, disponible partout.</h2>
      <p>Parce que chaque livre mérite d'être lu.</p>
      <button disabled={dbState !== "ready"} onClick={() => nav.reset({ name: "add" })}>Ajouter un livre</button>
    </section>
    <section className="stats">
      {stat("ALL", "Livres", library.length)}
      {stat("READING", "En cours", countStatus(library, "READING"))}
      {stat("TO_READ", "À lire", countStatus(library, "TO_READ"))}
      {stat("READ", "Lus", countStatus(library, "READ"))}
    </section>
  </>;
}
