import { useEffect, useMemo, useState } from "react";
import { canonicalAuthorDisplay, canonicalAuthorIdentity, canonicalAuthorSort, collapseToWorks, isSameWork, type BookSearchResult } from "@tsundoku/book-sources";
import { SearchCard } from "../components/BookCards";
import type { BookSearch } from "../hooks/useBookSearch";
import { isInLibrary, plural } from "../lib/library-view";
import { followAuthor } from "../services/authorLibrary";
import { getBookLanguageGroup, type BookSearchField, type SearchProvider } from "../services/bookSearch";
import { hasGoogleBooksApiKey } from "../services/credentials";
import { addBookToLibrary } from "../services/library";
import { useLibrary } from "../state/LibraryProvider";
import { useNavigation } from "../state/NavigationProvider";
import { usePreferences } from "../state/PreferencesProvider";

interface AuthorSearchGroup { key: string; name: string; books: BookSearchResult[] }

export function SearchScreen({ search }: { search: BookSearch }) {
  const { library, setLibrary, dbState } = useLibrary();
  const nav = useNavigation();
  const { preferredLanguage } = usePreferences();
  const [followBusy, setFollowBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [googleKeyKnown, setGoogleKeyKnown] = useState<boolean | null>(null);
  const { results, field, activeLanguage } = search;

  useEffect(() => {
    void hasGoogleBooksApiKey().then(setGoogleKeyKnown, () => setGoogleKeyKnown(null));
  }, []);

  const isAuthorSearch = field === "author" && results.length > 0;
  const ready = dbState === "ready";

  const authorGroups = useMemo<AuthorSearchGroup[]>(() => {
    if (field !== "author") return [];
    const inLanguage = activeLanguage === "all" ? results : results.filter(book => getBookLanguageGroup(book, activeLanguage) === "preferred");
    const groups = new Map<string, AuthorSearchGroup>();
    for (const book of collapseToWorks(inLanguage)) {
      const raw = book.authors[0] ?? search.q.trim();
      const key = canonicalAuthorIdentity(raw);
      if (!key) continue;
      const current = groups.get(key);
      if (current) current.books.push(book);
      else groups.set(key, { key, name: canonicalAuthorDisplay(raw), books: [book] });
    }
    return [...groups.values()]
      .map(group => ({ ...group, books: collapseToWorks(group.books) }))
      .sort((a, b) => b.books.length - a.books.length || canonicalAuthorSort(a.name).localeCompare(canonicalAuthorSort(b.name), "fr"));
  }, [results, field, activeLanguage, search.q]);

  async function add(book: BookSearchResult, owned: boolean) {
    setActionError("");
    try { setLibrary(await addBookToLibrary(book, owned)); }
    catch (x) { setActionError(x instanceof Error ? x.message : "Impossible d'ajouter le livre."); }
  }

  async function openAuthor(group: AuthorSearchGroup) {
    if (!ready || search.busy || followBusy) return;
    setFollowBusy(true);
    setActionError("");
    try {
      const { library: updated } = await followAuthor(group);
      setLibrary(updated);
      nav.push({ name: "author", key: group.key, authorName: group.name });
    } catch (x) {
      setActionError(x instanceof Error ? x.message : "Impossible d'ajouter la bibliographie de cet auteur.");
    } finally {
      setFollowBusy(false);
    }
  }

  const error = actionError || search.error;
  const anyOtherLanguage = activeLanguage !== "all" && results.some(book => getBookLanguageGroup(book, activeLanguage) !== "preferred");
  const visible = activeLanguage === "all" || search.showOtherLanguages
    ? results
    : results.filter(book => getBookLanguageGroup(book, activeLanguage) === "preferred");
  const hiddenCount = results.length - visible.length;
  // Sans clé Google, les éditions françaises récentes n'ont souvent aucune jaquette.
  const missingCovers = visible.filter(book => !book.coverUrl).length;
  const suggestGoogleKey = googleKeyKnown === false && !search.busy && missingCovers >= 5;

  return <>
    <form className="search-form" onSubmit={search.submit}>
      <input value={search.q} onChange={e => search.setQ(e.target.value)} placeholder="Titre, auteur ou ISBN…" />
      <select value={field} onChange={e => search.setField(e.target.value as BookSearchField)}>
        <option value="all">Recherche générale</option><option value="author">Auteur</option><option value="title">Titre</option><option value="isbn">ISBN</option>
      </select>
      <select value={search.provider} onChange={e => search.setProvider(e.target.value as SearchProvider)}>
        <option value="all">Toutes les sources</option><option value="bnf">BnF</option><option value="open-library">Open Library</option><option value="google-books">Google Books</option>
      </select>
      <button disabled={search.busy}>{search.busy ? "Recherche…" : "Rechercher"}</button>
    </form>
    {error && <p className="error">{error}</p>}
    {suggestGoogleKey && <p className="settings-help">
      {missingCovers} résultats sans jaquette. Une clé Google Books gratuite en retrouve beaucoup plus, surtout en français.{" "}
      <button type="button" className="text-button" onClick={() => nav.reset({ name: "settings" })}>Ouvrir les paramètres</button>
    </p>}
    {search.noPreferredResults && <section className="search-fallback"><p>Aucun résultat dans la langue préférée.</p><button type="button" onClick={() => void search.searchAllLanguages()}>Afficher toutes les langues</button></section>}

    {isAuthorSearch ? <>
      <section className="author-search-summary">
        <div><p className="eyebrow">Résultats auteurs</p><h2>Choisis l’auteur à suivre</h2></div>
        <p>En ouvrant un auteur, sa bibliographie est enregistrée localement. Tu peux ensuite marquer les livres possédés ou lus directement dans la liste.</p>
      </section>
      <div className="author-result-list">
        {authorGroups.map(group => {
          const owned = group.books.filter(book => library.some(local => local.owned && isSameWork(book, local))).length;
          return <article className="author-result" key={group.key}>
            <div>
              <p className="eyebrow">Auteur</p>
              <h2>{group.name}</h2>
              <p><strong>{group.books.length}</strong> {plural(group.books.length, "œuvre")} {plural(group.books.length, "trouvée")} · {owned} {plural(owned, "possédée")}</p>
            </div>
            <button type="button" disabled={search.busy || followBusy || !ready} onClick={() => void openAuthor(group)}>Ouvrir la bibliographie</button>
          </article>;
        })}
      </div>
      {anyOtherLanguage && <div className="load-more"><button type="button" onClick={() => void search.searchAllLanguages()}>Voir aussi les autres langues</button></div>}
    </> : <>
      <div className="grid">{visible.map(b =>
        <SearchCard key={`${b.source}-${b.sourceId}`} b={b} added={isInLibrary(b, library)}
          onAdd={ready ? book => void add(book, true) : undefined}
          onTrack={ready ? book => void add(book, false) : undefined} />)}
      </div>
      {hiddenCount > 0 && <div className="load-more"><button type="button" onClick={() => search.setShowOtherLanguages(true)}>Afficher les autres langues / indéterminées ({hiddenCount})</button></div>}
    </>}
    {field !== "author" && results.length > 0 && search.canLoadMore && <div className="load-more"><button type="button" disabled={search.busy} onClick={() => void search.loadMore()}>{search.busy ? "Chargement…" : "Charger plus"}</button></div>}
  </>;
}
