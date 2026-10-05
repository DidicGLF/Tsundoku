import { GoogleBooksClient, OpenLibraryClient, type BookSearchResult } from "@tsundoku/book-sources";
import { getCredentialStore } from "./credentials";

export type SearchProvider = "all" | "open-library" | "google-books";

const openLibrary = new OpenLibraryClient();
const googleBooks = new GoogleBooksClient(getCredentialStore());

export async function searchBooks(q: string, p: SearchProvider): Promise<BookSearchResult[]> {
  q = q.trim();
  if (!q) return [];
  if (p === "open-library") return openLibrary.search(q);
  if (p === "google-books") return googleBooks.search(q);

  const settled = await Promise.allSettled([openLibrary.search(q), googleBooks.search(q)]);
  const all = settled.flatMap(result => result.status === "fulfilled" ? result.value : []);
  if (!all.length && settled.every(result => result.status === "rejected")) {
    throw new Error("Aucune source de livres n'est disponible.");
  }

  const unique = new Map<string, BookSearchResult>();
  for (const book of all) {
    const key = book.isbn13 || book.isbn10 || `${book.title.toLowerCase()}::${book.authors[0]?.toLowerCase() ?? ""}`;
    if (!unique.has(key)) unique.set(key, book);
  }
  return [...unique.values()];
}
