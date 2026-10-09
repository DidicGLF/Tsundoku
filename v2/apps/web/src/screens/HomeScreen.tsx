import { useMemo, useState } from "react";
import { countStatus, newReleases, primaryAuthor, recentAdditions, displayTitle, type LibraryFilter } from "../lib/library-view";
import { LibraryTile } from "../components/BookCards";
import { Cover } from "../components/Cover";
import { UpdateBanner } from "../components/UpdateBanner";
import { dismissBackupNudge, shouldNudgeBackup } from "../services/backup";
import { useLibrary } from "../state/LibraryProvider";
import { useNavigation } from "../state/NavigationProvider";
import type { LibraryFilters } from "../hooks/useLibraryFilters";

export function HomeScreen({ filters }: { filters: LibraryFilters }) {
  const { library, dbState } = useLibrary();
  const nav = useNavigation();
  const [nudgeHidden, setNudgeHidden] = useState(false);
  const nudge = !nudgeHidden && dbState === "ready" && shouldNudgeBackup(library.length);

  const releases = useMemo(() => newReleases(library, 4), [library]);
  const recent = useMemo(() => recentAdditions(library), [library]);
  const openBook = (id: string) => nav.push({ name: "detail", id });

  const openLibrary = (filter: LibraryFilter) => { filters.setFilter(filter); nav.reset({ name: "library" }); };
  const stat = (filter: LibraryFilter, label: string, count: number) =>
    <button onClick={() => openLibrary(filter)}><strong>{count}</strong><span>{label}</span></button>;

  return <>
    <UpdateBanner />
    {nudge && <section className="backup-nudge" role="status">
      <p>Pense à sauvegarder ta bibliothèque : un export prend une seconde.</p>
      <div>
        <button type="button" onClick={() => nav.reset({ name: "settings" })}>Sauvegarder</button>
        <button type="button" className="text-button" onClick={() => { dismissBackupNudge(); setNudgeHidden(true); }}>Plus tard</button>
      </div>
    </section>}
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
    {releases.length > 0 && <section className="home-shelf" aria-labelledby="home-releases">
      <div className="home-shelf-head">
        <h3 id="home-releases">Nouveautés</h3>
        <span>Les parutions de tes auteurs suivis</span>
      </div>
      <ul className="release-list">
        {releases.map(book => <li key={book.id}>
          <button type="button" onClick={() => openBook(book.id)}>
            <Cover book={book} variant="mini" />
            <span>
              <strong>{displayTitle(book.title)}</strong>
              <em>{[primaryAuthor(book), book.publishedYear ? String(book.publishedYear) : ""].filter(Boolean).join(" · ")}</em>
            </span>
          </button>
        </li>)}
      </ul>
    </section>}
    {recent.length > 0 && <section className="home-shelf" aria-labelledby="home-recent">
      <div className="home-shelf-head">
        <h3 id="home-recent">Derniers ajouts</h3>
        <button type="button" className="text-button" onClick={() => openLibrary("OWNED")}>Bibliothèque</button>
      </div>
      <div className="recent-row">
        {recent.map(book => <LibraryTile key={book.id} b={book} onOpen={b => openBook(b.id)} />)}
      </div>
    </section>}
  </>;
}
