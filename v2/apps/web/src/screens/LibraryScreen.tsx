import { useMemo } from "react";
import { canonicalAuthorIdentity } from "@tsundoku/book-sources";
import { AuthorAvatar } from "../components/AuthorAvatar";
import { LibraryTile } from "../components/BookCards";
import { filterLibrary, groupByAuthor, libraryFilterCounts, plural, sortLibrary, type LibrarySort } from "../lib/library-view";
import type { LibraryFilters } from "../hooks/useLibraryFilters";
import { useLibrary } from "../state/LibraryProvider";
import { useNavigation } from "../state/NavigationProvider";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

export function LibraryScreen({ filters }: { filters: LibraryFilters }) {
  const { library } = useLibrary();
  const nav = useNavigation();
  const { query, filter, sort } = filters;

  const filtered = useMemo(() => sortLibrary(filterLibrary(library, filter, query), sort), [library, filter, query, sort]);
  const groups = useMemo(() => groupByAuthor(filtered, sort), [filtered, sort]);
  const initials = useMemo(() => new Set(groups.map(group => group.initial)), [groups]);
  const filterButtons = useMemo(() => libraryFilterCounts(library), [library]);

  return <>
    <section className="library-toolbar">
      <div className="library-search">
        <input value={query} onChange={e => filters.setQuery(e.target.value)} placeholder="Rechercher dans ma bibliothèque…" />
        <select value={sort} onChange={e => filters.setSort(e.target.value as LibrarySort)}>
          <option value="RECENT">Modifiés récemment</option>
          <option value="TITLE">Titre</option>
          <option value="AUTHOR">Auteur</option>
          <option value="PROGRESS">Progression</option>
          <option value="COVER">Jaquette d'abord</option>
        </select>
      </div>
      <div className="filter-row">
        {filterButtons.map(([value, label, count]) =>
          <button key={value} className={filter === value ? "filter active" : "filter"} onClick={() => filters.setFilter(value)}>
            {label} <span>{count}</span>
          </button>
        )}
      </div>
    </section>

    <div className="library-summary">
      <h2>{filtered.length} {plural(filtered.length, "livre")}</h2>
      {(query || filter !== "ALL") && <button className="text-button" onClick={filters.clear}>Effacer les filtres</button>}
    </div>

    {filtered.length > 0 ? <>
      <nav className="alphabet-strip" aria-label="Accès rapide par auteur">
        {ALPHABET.map(letter => initials.has(letter)
          ? <a key={letter} href={`#letter-${letter}`}>{letter}</a>
          : <span key={letter}>{letter}</span>)}
        {initials.has("#") && <a href="#letter-other">#</a>}
      </nav>
      <div className="author-library">
        {groups.map((group, index) => {
          const showLetter = group.initial !== groups[index - 1]?.initial;
          const letterId = group.initial === "#" ? "letter-other" : `letter-${group.initial}`;
          const missing = group.books.length - group.ownedCount;
          return <section className="author-section" id={group.anchor} key={group.anchor}>
            {showLetter && <div className="author-letter-anchor" id={letterId}>{group.initial}</div>}
            <div className="author-heading">
              <button type="button" className="author-open"
                onClick={() => nav.push({ name: "author", key: canonicalAuthorIdentity(group.author), authorName: group.author })}>
                <AuthorAvatar name={group.author} />
                <span><p className="eyebrow">Auteur</p><h2>{group.author}</h2></span>
              </button>
              <div className="author-count">
                <strong>{group.ownedCount}/{group.books.length}</strong>
                <span>{plural(group.ownedCount, "possédé")}</span>
                <em>{missing} {plural(missing, "manquant")}</em>
              </div>
            </div>
            <div className="author-meter" aria-hidden="true"><i style={{ width: `${Math.round((group.ownedCount / group.books.length) * 100)}%` }} /></div>
            <div className="tile-grid">{group.books.map(b => <LibraryTile key={b.id} b={b} onOpen={book => nav.push({ name: "detail", id: book.id })} />)}</div>
          </section>;
        })}
      </div>
    </> : <section className="empty-state">
      <div>📚</div><h2>Aucun livre trouvé</h2><p>Essaie un autre filtre ou une autre recherche.</p>
      <button onClick={filters.clear}>Voir toute la bibliothèque</button>
    </section>}
  </>;
}
