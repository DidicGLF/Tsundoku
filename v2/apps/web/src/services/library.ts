import type { BookSearchResult } from "@tsundoku/book-sources";
import {
  SqliteLibraryRepository,
  runMigrations,
  type StoredLibraryBook
} from "@tsundoku/database";
import { WebSqliteAdapter } from "../database/WebSqliteAdapter";

let repositoryPromise: Promise<SqliteLibraryRepository> | null = null;

function withTimeout<T>(
  promise: Promise<T>,
  milliseconds: number,
  label: string
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(
      () =>
        reject(
          new Error(
            `${label} a dépassé ${milliseconds / 1000} secondes.`
          )
        ),
      milliseconds
    );

    promise.then(
      value => {
        window.clearTimeout(timer);
        resolve(value);
      },
      error => {
        window.clearTimeout(timer);
        reject(error);
      }
    );
  });
}

async function createRepository(): Promise<SqliteLibraryRepository> {
  const adapter = await withTimeout(
    WebSqliteAdapter.create(),
    10000,
    "L'initialisation de SQLite"
  );

  await withTimeout(
    runMigrations(adapter),
    10000,
    "La migration de la base SQLite"
  );

  return new SqliteLibraryRepository(adapter);
}

function repository(): Promise<SqliteLibraryRepository> {
  repositoryPromise ??= createRepository();
  return repositoryPromise;
}

export async function initializeLibrary(): Promise<StoredLibraryBook[]> {
  return (await repository()).list();
}

export async function addBookToLibrary(
  book: BookSearchResult
): Promise<StoredLibraryBook[]> {
  const repo = await repository();

  const storedBook: StoredLibraryBook = {
    id: crypto.randomUUID(),
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
    status: "TO_READ",
    addedAt: new Date().toISOString()
  };

  await repo.add(storedBook);

  return repo.list();
}

export type LibraryBook = StoredLibraryBook;
