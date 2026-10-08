import { canonicalAuthorIdentity, collapseToWorks, isSameWork, type BookSearchResult } from "@tsundoku/book-sources";
import { enrichSearchResults, searchCompleteAuthorBibliography, type BookSearchLanguage } from "./bookSearch";
import {
  addBooksToLibrary,
  clearNewlyDiscoveredBooks,
  refreshLibraryMetadata,
  removeBooksFromLibrary,
  removeFollowedAuthor,
  saveFollowedAuthor,
  type LibraryBook
} from "./library";
import { attributeOrphans, booksOfAuthor, findNewWorks } from "../lib/library-view";

/**
 * Suit un auteur : sa bibliographie entre dans la bibliothèque locale, les œuvres
 * non cochées étant simplement des livres manquants (owned = false).
 */
export async function followAuthor(group: { key: string; name: string; books: BookSearchResult[] }): Promise<{ library: LibraryBook[]; refreshedAt: string }> {
  const start = performance.now();
  const library = await addBooksToLibrary(attributeOrphans(group.books, group.name), false);
  console.info(`[tsundoku] suivi de ${group.name}: ${group.books.length} œuvres en ${Math.round(performance.now() - start)} ms`);
  const refreshedAt = new Date().toISOString();
  await saveFollowedAuthor(group.key, group.name, refreshedAt);
  return { library, refreshedAt };
}

/** Supprime un auteur suivi et tous ses livres de la bibliothèque. */
export async function unfollowAuthor(authorKey: string, books: LibraryBook[]): Promise<LibraryBook[]> {
  const library = await removeBooksFromLibrary(books.map(book => book.id));
  await removeFollowedAuthor(authorKey);
  return library;
}

/**
 * Complète jaquettes et métadonnées des livres locaux à partir de `found`.
 * Chaque étape de recherche est écrite en base dès qu'elle aboutit : quitter l'écran
 * n'annule rien, et `onUpdate` (si l'écran est encore là) reçoit la bibliothèque à jour.
 * Best effort : toute erreur est ignorée, une jaquette manquante ne bloque rien.
 */
export async function enrichLibraryBooks(
  found: BookSearchResult[], localBooks: LibraryBook[], language: BookSearchLanguage,
  onUpdate?: (library: LibraryBook[]) => void
): Promise<void> {
  const saved = new Map<string, boolean>(); // id → jaquette déjà écrite
  let writes: Promise<unknown> = Promise.resolve();

  const persist = (enriched: BookSearchResult[]) => {
    const matches = enriched.flatMap(book => {
      if (!book.coverUrl && !book.description && !book.pageCount && !book.language) return [];
      const local = localBooks.find(candidate => isSameWork(book, candidate));
      if (!local) return [];
      // Chaque livre est écrit une fois, et une seconde si sa jaquette arrive à une étape suivante.
      const done = saved.get(local.id);
      if (done !== undefined && (done || !book.coverUrl)) return [];
      saved.set(local.id, Boolean(book.coverUrl));
      return [{ id: local.id, book }];
    });
    if (!matches.length) return;
    writes = writes
      .then(() => refreshLibraryMetadata(matches))
      .then(library => onUpdate?.(library))
      .catch(() => undefined);
  };

  try {
    persist(await enrichSearchResults(found, language, persist));
  } catch {
    // réseau indisponible : on réessaiera à la prochaine ouverture
  }
  await writes;
}

export interface AuthorRefreshResult {
  library: LibraryBook[];
  refreshedAt: string;
  /** Catalogue complet de l'auteur (une entrée par œuvre). */
  remote: BookSearchResult[];
  newCount: number;
}

/** Recherche les nouvelles œuvres d'un auteur suivi et les ajoute comme « manquantes, nouveautés ». */
export async function refreshAuthor(authorKey: string, authorName: string, library: LibraryBook[], language: BookSearchLanguage): Promise<AuthorRefreshResult> {
  const remoteRaw = await searchCompleteAuthorBibliography(authorName, "all", language, true);
  const remote = collapseToWorks(remoteRaw.filter(book => {
    const key = canonicalAuthorIdentity(book.authors[0] ?? authorName);
    return !key || key === authorKey;
  }));

  const current = booksOfAuthor(library, authorKey);
  const newBooks = attributeOrphans(findNewWorks(remote, current), authorName);

  let updated = current.some(book => book.newlyDiscovered)
    ? await clearNewlyDiscoveredBooks(current.map(book => book.id))
    : library;
  if (newBooks.length) updated = await addBooksToLibrary(newBooks, false, true);

  const refreshedAt = new Date().toISOString();
  await saveFollowedAuthor(authorKey, authorName, refreshedAt);
  return { library: updated, refreshedAt, remote, newCount: newBooks.length };
}
