import type { BookSearchResult } from "@tsundoku/book-sources";
import {
  SqliteNormalizedLibraryRepository,
  runMigrations,
  type StoredLibraryBook,
  type LibraryBookUpdate,
  type ReadingSession,
  type NewReadingSession
} from "@tsundoku/database";
import { createSqliteAdapter } from "../database/createSqliteAdapter";

let repositoryPromise: Promise<SqliteNormalizedLibraryRepository> | null = null;

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

async function createRepository(): Promise<SqliteNormalizedLibraryRepository> {
  const adapter = await withTimeout(createSqliteAdapter(), 15000, "L'initialisation de SQLite");
  await withTimeout(runMigrations(adapter), 15000, "La migration de la base SQLite");
  return new SqliteNormalizedLibraryRepository(adapter);
}

function repository(): Promise<SqliteNormalizedLibraryRepository> {
  repositoryPromise ??= createRepository();
  return repositoryPromise;
}

export async function initializeLibrary(): Promise<StoredLibraryBook[]> {
  return (await repository()).list();
}

export async function addBookToLibrary(book: BookSearchResult, owned = true): Promise<StoredLibraryBook[]> {
  const repo = await repository();
  await repo.add({
    source: book.source,
    sourceId: book.sourceId,
    title: book.title,
    authors: book.authors,
    publishedYear: book.publishedYear,
    publisher: book.publisher,
    isbn10: book.isbn10,
    isbn13: book.isbn13,
    pageCount: book.pageCount,
    language: book.language,
    description: book.description,
    coverUrl: book.coverUrl,
    seriesName: book.seriesName,
    seriesVolume: book.seriesVolume,
    owned
  });
  return repo.list();
}


export async function addBooksToLibrary(books: BookSearchResult[], owned = false, newlyDiscovered = false): Promise<StoredLibraryBook[]> {
  const repo = await repository();
  for (const book of books) {
    await repo.add({
      source: book.source,
      sourceId: book.sourceId,
      title: book.title,
      authors: book.authors,
      publishedYear: book.publishedYear,
      publisher: book.publisher,
      isbn10: book.isbn10,
      isbn13: book.isbn13,
      pageCount: book.pageCount,
      language: book.language,
      description: book.description,
      coverUrl: book.coverUrl,
      seriesName: book.seriesName,
      seriesVolume: book.seriesVolume,
      owned,
      newlyDiscovered
    });
  }
  return repo.list();
}


export async function refreshLibraryMetadata(
  matches: Array<{ id: string; book: BookSearchResult }>
): Promise<StoredLibraryBook[]> {
  const repo = await repository();
  for (const { id, book } of matches) {
    await repo.refreshMetadata(id, {
      source: book.source,
      sourceId: book.sourceId,
      title: book.title,
      authors: book.authors,
      publishedYear: book.publishedYear,
      publisher: book.publisher,
      isbn10: book.isbn10,
      isbn13: book.isbn13,
      pageCount: book.pageCount,
      language: book.language,
      description: book.description,
      coverUrl: book.coverUrl,
      seriesName: book.seriesName,
      seriesVolume: book.seriesVolume
    });
  }
  return repo.list();
}

export async function removeBookFromLibrary(id: string): Promise<StoredLibraryBook[]> {
  const repo = await repository();
  await repo.remove(id);
  return repo.list();
}

export async function removeBooksFromLibrary(ids: string[]): Promise<StoredLibraryBook[]> {
  const repo = await repository();
  for (const id of ids) await repo.remove(id);
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

export async function getReadingSessions(bookId: string): Promise<ReadingSession[]> {
  return (await repository()).listReadingSessions(bookId);
}

export async function addReadingSession(bookId: string, session: NewReadingSession): Promise<{ library: StoredLibraryBook[]; sessions: ReadingSession[] }> {
  const repo = await repository();
  await repo.addReadingSession(bookId, session);
  return { library: await repo.list(), sessions: await repo.listReadingSessions(bookId) };
}

export interface FollowedAuthorInfo {
  authorKey: string;
  name: string;
  lastRefreshedAt?: string;
}

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
export type { LibraryBookUpdate, ReadingSession, NewReadingSession };
