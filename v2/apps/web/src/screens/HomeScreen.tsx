import { useState } from "react";
import { countStatus, type LibraryFilter } from "../lib/library-view";
import { dismissBackupNudge, shouldNudgeBackup } from "../services/backup";
import { useLibrary } from "../state/LibraryProvider";
import { useNavigation } from "../state/NavigationProvider";
import type { LibraryFilters } from "../hooks/useLibraryFilters";

export function HomeScreen({ filters }: { filters: LibraryFilters }) {
  const { library, dbState } = useLibrary();
  const nav = useNavigation();
  const [nudgeHidden, setNudgeHidden] = useState(false);
  const nudge = !nudgeHidden && dbState === "ready" && shouldNudgeBackup(library.length);

  const openLibrary = (filter: LibraryFilter) => { filters.setFilter(filter); nav.reset({ name: "library" }); };
  const stat = (filter: LibraryFilter, label: string, count: number) =>
    <button onClick={() => openLibrary(filter)}><strong>{count}</strong><span>{label}</span></button>;

  return <>
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
  </>;
}
