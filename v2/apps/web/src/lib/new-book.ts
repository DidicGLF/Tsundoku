import { canonicalAuthorDisplay, canonicalIsbn, type BookSearchResult } from "@tsundoku/book-sources";
import type { NewLibraryBook } from "@tsundoku/database";

/** Un résultat de recherche (ou un livre de sauvegarde) sous la forme enregistrée en base. */
export function toNewBook(book: BookSearchResult, extra: Pick<NewLibraryBook, "owned" | "newlyDiscovered"> = {}): NewLibraryBook {
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
    collection: book.collection,
    coverUrl: book.coverUrl,
    seriesName: book.seriesName,
    seriesVolume: book.seriesVolume,
    ...extra
  };
}
