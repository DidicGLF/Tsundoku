import { cleanIsbn, isbn10To13, isbn13To10, type BookSearchResult } from "@tsundoku/book-sources";
import {
  SqliteLibraryRepository,
  runMigrations,
  type FollowedAuthor,
  type NewLibraryBook,
  type StoredLibraryBook,
  type LibraryBookUpdate,
} from "@tsundoku/database";
import { applyImportTo, type BackupFile, type ImportPlan, type ImportReport } from "../lib/backup";
import { completeAuthorNames, createWorkIndex, editionOf, findLocalWork, planDuplicateMerges } from "../lib/library-view";
import { toNewBook } from "../lib/new-book";
import { searchBooks } from "./bookSearch";
import { createSqliteAdapter } from "../database/createSqliteAdapter";

let repositoryPromise: Promise<SqliteLibraryRepository> | null = null;

function withTimeout<T>(promise: Promise<T>, milliseconds: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error(`${label} a dépassé ${milliseconds / 1000} secondes.`)),
      milliseconds
    );
    promise.then(
      value => { window.clearTimeout(timer); resolve(value); },
      error => { window.clearTimeout(timer); reject(error); }
    );
  });
}

async function createRepository(): Promise<SqliteLibraryRepository> {
  const adapter = await withTimeout(createSqliteAdapter(), 15000, "L'initialisation de SQLite");
  await withTimeout(runMigrations(adapter), 15000, "La migration de la base SQLite");
  return new SqliteLibraryRepository(adapter);
}

function repository(): Promise<SqliteLibraryRepository> {
  repositoryPromise ??= createRepository();
  return repositoryPromise;
}

/** Search result -> library input, with catalogue author labels normalized and ISBN-13 derived. */

export async function initializeLibrary(): Promise<StoredLibraryBook[]> {
  const repo = await repository();
  const library = await repo.list();
  const merges = planDuplicateMerges(library);
  if (!merges.length) return library;
  try {
    await repo.batch(async () => {
      for (const merge of merges) {
        if (Object.keys(merge.changes).length) await repo.update(merge.keepId, merge.changes);
        if (merge.edition) await repo.setEdition(merge.keepId, merge.edition);
        for (const id of merge.removeIds) await repo.remove(id);
      }
    });
    return await repo.list();
  } catch (error) {
    // La fusion est un confort : en cas d'échec, la bibliothèque s'ouvre quand même telle quelle.
    console.error("Fusion des doublons impossible:", error);
    return library;
  }
}

/**
 * Ajoute un livre. S'il correspond déjà à une œuvre de la bibliothèque (autre édition, autre ISBN,
 * titre de catalogue différent), c'est cette œuvre qui est mise à jour : pas de doublon.
 */
export async function addBookToLibrary(book: BookSearchResult, owned = true): Promise<StoredLibraryBook[]> {
  const repo = await repository();
  const library = await repo.list();
  const local = findLocalWork(book, createWorkIndex(library));
  if (local) {
    if (owned && !local.owned) {
      await repo.update(local.id, { owned: true, newlyDiscovered: false });
      // Ce qu'on possède, c'est cette édition-là : son ISBN et sa jaquette remplacent ceux de la fiche.
      await repo.setEdition(local.id, editionOf(book));
    }
    await repo.refreshMetadata(local.id, toNewBook(book));
  } else {
    // Un nom d'auteur incomplet (« Eddings ») rejoint celui de la bibliothèque (« David Eddings »).
    await repo.add(toNewBook({ ...book, authors: completeAuthorNames(book.authors, library) }, { owned }));
  }
  return repo.list();
}

/** « C'est mon édition » : la fiche de cette œuvre prend l'ISBN, l'éditeur et la jaquette de ce résultat. */
export async function adoptEdition(book: BookSearchResult): Promise<StoredLibraryBook[]> {
  const repo = await repository();
  const local = findLocalWork(book, createWorkIndex(await repo.list()));
  if (local) {
    if (!local.owned) await repo.update(local.id, { owned: true, newlyDiscovered: false });
    await repo.setEdition(local.id, editionOf(book));
  }
  return repo.list();
}

/**
 * « Mon exemplaire a cet ISBN » : la fiche prend cet ISBN (et, si une source le connaît, son éditeur,
 * ses pages, etc.) avec la jaquette choisie.
 */
export async function setBookEditionByIsbn(id: string, isbn: string, coverUrl: string | null): Promise<StoredLibraryBook[]> {
  const repo = await repository();
  const clean = cleanIsbn(isbn);
  if (!clean) throw new Error("ISBN invalide.");
  const found = (await searchBooks(clean, "all", "all", 0, "isbn").catch(() => []))[0];
  const edition = found ? editionOf({ ...found, coverUrl: coverUrl ?? undefined }) : {
    isbn13: clean.length === 13 ? clean : isbn10To13(clean),
    isbn10: clean.length === 10 ? clean : isbn13To10(clean),
    coverUrl
  };
  await repo.setEdition(id, { ...edition, coverUrl });
  return repo.list();
}

/** Choix manuel de la jaquette (`null` la retire). */
export async function setBookCover(id: string, url: string | null): Promise<StoredLibraryBook[]> {
  const repo = await repository();
  await repo.setEdition(id, { coverUrl: url });
  return repo.list();
}

export async function addBooksToLibrary(books: BookSearchResult[], owned = false, newlyDiscovered = false): Promise<StoredLibraryBook[]> {
  const repo = await repository();
  const index = createWorkIndex(await repo.list());
  const fresh: BookSearchResult[] = [];
  const upgrade = new Set<string>();
  for (const book of books) {
    const local = findLocalWork(book, index);
    if (!local) fresh.push(book);
    else if (owned && !local.owned) upgrade.add(local.id);
  }
  await repo.batch(async () => {
    for (const id of upgrade) await repo.update(id, { owned: true, newlyDiscovered: false });
    await repo.addMany(fresh.map(book => toNewBook(book, { owned, newlyDiscovered })));
  });
  return repo.list();
}

export async function refreshLibraryMetadata(
  matches: Array<{ id: string; book: BookSearchResult }>
): Promise<StoredLibraryBook[]> {
  const repo = await repository();
  await repo.batch(async () => { for (const { id, book } of matches) await repo.refreshMetadata(id, toNewBook(book)); });
  return repo.list();
}

export async function removeBookFromLibrary(id: string): Promise<StoredLibraryBook[]> {
  const repo = await repository();
  await repo.remove(id);
  return repo.list();
}

export async function removeBooksFromLibrary(ids: string[]): Promise<StoredLibraryBook[]> {
  const repo = await repository();
  await repo.batch(async () => { for (const id of ids) await repo.remove(id); });
  return repo.list();
}

export async function updateLibraryBook(
  id: string,
  changes: LibraryBookUpdate
): Promise<StoredLibraryBook[]> {
  const repo = await repository();
  await repo.update(id, changes);
  return repo.list();
}

/** Tout ce qu'une sauvegarde contient : les livres et les auteurs suivis. */
export async function exportLibraryData(): Promise<{ library: StoredLibraryBook[]; followed: FollowedAuthor[] }> {
  const repo = await repository();
  return { library: await repo.list(), followed: await repo.listFollowedAuthors() };
}

/** Applique le plan d'import en une seule transaction : tout ou rien. */
export async function applyImport(plan: ImportPlan, backup: BackupFile): Promise<ImportReport & { library: StoredLibraryBook[] }> {
  const repo = await repository();
  const report = await applyImportTo(repo, plan, backup);
  return { ...report, library: await repo.list() };
}

export type FollowedAuthorInfo = FollowedAuthor;

export async function getFollowedAuthor(authorKey: string): Promise<FollowedAuthorInfo | null> {
  return (await repository()).getFollowedAuthor(authorKey);
}

export async function saveFollowedAuthor(authorKey: string, name: string, refreshedAt = new Date().toISOString()): Promise<void> {
  await (await repository()).upsertFollowedAuthor(authorKey, name, refreshedAt);
}

export async function removeFollowedAuthor(authorKey: string): Promise<void> {
  await (await repository()).removeFollowedAuthor(authorKey);
}

export async function clearNewlyDiscoveredBooks(ids: string[]): Promise<StoredLibraryBook[]> {
  const repo = await repository();
  for (const id of ids) await repo.update(id, { newlyDiscovered: false });
  return repo.list();
}

export type LibraryBook = StoredLibraryBook;
export type { LibraryBookUpdate };
