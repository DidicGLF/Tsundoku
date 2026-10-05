import type { BookSearchResult } from "@tsundoku/book-sources";
import {
  SqliteNormalizedLibraryRepository,
  runMigrations,
  type StoredLibraryBook,
  type LibraryBookUpdate
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

export async function addBookToLibrary(book: BookSearchResult): Promise<StoredLibraryBook[]> {
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
    coverUrl: book.coverUrl
  });
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

export type LibraryBook = StoredLibraryBook;
export type { LibraryBookUpdate };
