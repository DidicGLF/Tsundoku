import { canonicalAuthorDisplay, canonicalIsbn, type BookSearchResult } from "@tsundoku/book-sources";
import {
  SqliteLibraryRepository,
  runMigrations,
  type FollowedAuthor,
  type NewLibraryBook,
  type StoredLibraryBook,
  type LibraryBookUpdate,
} from "@tsundoku/database";
import { createWorkIndex, findLocalWork, planDuplicateMerges } from "../lib/library-view";
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
function toNewBook(book: BookSearchResult, extra: Pick<NewLibraryBook, "owned" | "newlyDiscovered"> = {}): NewLibraryBook {
  return {
    source: book.source,
    sourceId: book.sourceId,
    title: book.title,
    authors: book.authors.map(canonicalAuthorDisplay).filter(name => name !== "Auteur inconnu"),
    publishedYear: book.publishedYear,
    publisher: book.publisher,
    isbn10: book.isbn10,
    isbn13: canonicalIsbn(book) ?? book.isbn13,
    pageCount: book.pageCount,
    language: book.language,
    description: book.description,
    coverUrl: book.coverUrl,
    seriesName: book.seriesName,
    seriesVolume: book.seriesVolume,
    ...extra
  };
}

export async function initializeLibrary(): Promise<StoredLibraryBook[]> {
  const repo = await repository();
  const library = await repo.list();
  const merges = planDuplicateMerges(library);
  if (!merges.length) return library;
  try {
    await repo.batch(async () => {
      for (const merge of merges) {
        if (Object.keys(merge.changes).length) await repo.update(merge.keepId, merge.changes);
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
  const local = findLocalWork(book, createWorkIndex(await repo.list()));
  if (local) {
    if (owned && !local.owned) await repo.update(local.id, { owned: true, newlyDiscovered: false });
    await repo.refreshMetadata(local.id, toNewBook(book));
  } else {
    await repo.add(toNewBook(book, { owned }));
  }
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
