import { canonicalAuthorDisplay, canonicalAuthorIdentity, canonicalAuthorSort, isSameWork, normalizeText, type BookSearchResult } from "@tsundoku/book-sources";
import type { ReadingStatus } from "@tsundoku/database";
import type { LibraryBook } from "../services/library";

export const statusLabels: Record<ReadingStatus, string> = {
  TO_READ: "À lire",
  READING: "En cours",
  READ: "Lu",
  ON_HOLD: "En pause",
  ABANDONED: "Abandonné"
};

export type LibraryFilter = "ALL" | ReadingStatus | "FAVORITES" | "OWNED" | "MISSING";
export type LibrarySort = "RECENT" | "TITLE" | "AUTHOR" | "PROGRESS";
export type AuthorBookFilter = "ALL" | "MISSING" | "OWNED" | "READ" | "TO_READ";
export type AuthorBookSort = "MISSING" | "TITLE" | "DATE";

export function displayAuthors(authors: string[]): string {
  const values = authors.map(canonicalAuthorDisplay).filter(name => name && name !== "Auteur inconnu");
  return values.join(", ") || "Auteur inconnu";
}

export function countStatus(library: LibraryBook[], status: ReadingStatus): number {
  return library.filter(book => book.status === status).length;
}

/** Reading progress in percent, or -1 when unknown (so unknown sorts last). */
export function progressPercent(book: LibraryBook): number {
  if (!book.progressTotal || book.progressValue == null) return -1;
  return Math.min(100, (book.progressValue / book.progressTotal) * 100);
}

export function primaryAuthor(book: LibraryBook): string {
  return canonicalAuthorDisplay(book.authors[0] ?? "");
}

export function authorInitial(author: string): string {
  const first = canonicalAuthorSort(author).trim()[0]?.toUpperCase() ?? "#";
  return /^[A-Z]$/.test(first) ? first : "#";
}

const byRecent = (a: LibraryBook, b: LibraryBook) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
const byTitle = (a: { title: string }, b: { title: string }) => a.title.localeCompare(b.title, "fr");

export function filterLibrary(library: LibraryBook[], filter: LibraryFilter, query: string): LibraryBook[] {
  const needle = query.trim().toLocaleLowerCase("fr");
  return library.filter(book => {
    const matchesFilter =
      filter === "ALL" ||
      (filter === "FAVORITES" ? book.favorite :
        filter === "OWNED" ? book.owned :
        filter === "MISSING" ? !book.owned :
        book.status === filter);
    if (!matchesFilter) return false;
    if (!needle) return true;
    return [book.title, ...book.authors, book.isbn10 ?? "", book.isbn13 ?? "", book.publisher ?? ""]
      .join(" ").toLocaleLowerCase("fr").includes(needle);
  });
}

export function sortLibrary(books: LibraryBook[], sort: LibrarySort): LibraryBook[] {
  return [...books].sort((a, b) => {
    if (sort === "TITLE") return byTitle(a, b);
    if (sort === "AUTHOR") return canonicalAuthorSort(primaryAuthor(a)).localeCompare(canonicalAuthorSort(primaryAuthor(b)), "fr");
    if (sort === "PROGRESS") return progressPercent(b) - progressPercent(a);
    return byRecent(a, b);
  });
}

export interface AuthorGroup {
  author: string;
  initial: string;
  anchor: string;
  books: LibraryBook[];
  ownedCount: number;
}

/** Groups books by primary author (alphabetical), ordering each group by `sort`. */
export function groupByAuthor(books: LibraryBook[], sort: LibrarySort): AuthorGroup[] {
  const groups = new Map<string, { author: string; books: LibraryBook[] }>();
  for (const book of books) {
    const author = primaryAuthor(book);
    const key = canonicalAuthorIdentity(author);
    const current = groups.get(key);
    if (current) current.books.push(book);
    else groups.set(key, { author, books: [book] });
  }

  return [...groups.values()]
    .sort((a, b) => canonicalAuthorSort(a.author).localeCompare(canonicalAuthorSort(b.author), "fr"))
    .map(group => ({
      author: group.author,
      initial: authorInitial(group.author),
      anchor: `author-${normalizeText(group.author).replace(/\s+/g, "-") || "unknown"}`,
      books: [...group.books].sort((a, b) =>
        sort === "PROGRESS" ? progressPercent(b) - progressPercent(a) :
        sort === "RECENT" ? byRecent(a, b) : byTitle(a, b)),
      ownedCount: group.books.filter(book => book.owned).length
    }));
}

export function libraryFilterCounts(library: LibraryBook[]): Array<[LibraryFilter, string, number]> {
  return [
    ["ALL", "Tous", library.length],
    ["MISSING", "Manquants", library.filter(book => !book.owned).length],
    ["OWNED", "Possédés", library.filter(book => book.owned).length],
    ["TO_READ", "À lire", countStatus(library, "TO_READ")],
    ["READING", "En cours", countStatus(library, "READING")],
    ["READ", "Lus", countStatus(library, "READ")],
    ["ON_HOLD", "En pause", countStatus(library, "ON_HOLD")],
    ["ABANDONED", "Abandonnés", countStatus(library, "ABANDONED")],
    ["FAVORITES", "★ Favoris", library.filter(book => book.favorite).length]
  ];
}

/** True when a search result is already in the library (same ISBN or same source id). */
export function isInLibrary(result: BookSearchResult, library: LibraryBook[]): boolean {
  return library.some(book =>
    (result.isbn13 && book.isbn13 === result.isbn13) ||
    (result.isbn10 && book.isbn10 === result.isbn10) ||
    (book.source === result.source && book.sourceId === result.sourceId));
}

/* ---- Author bibliography ---- */

export function booksOfAuthor(library: LibraryBook[], authorKey: string | null): LibraryBook[] {
  if (!authorKey) return [];
  return library.filter(book => canonicalAuthorIdentity(book.authors[0] ?? "") === authorKey);
}

export function authorStats(books: LibraryBook[]) {
  const owned = books.filter(book => book.owned).length;
  const read = books.filter(book => book.status === "READ").length;
  return {
    total: books.length,
    owned,
    read,
    missing: books.length - owned,
    unread: books.length - read,
    newlyDiscovered: books.filter(book => book.newlyDiscovered).length
  };
}

export function filterAuthorBooks(books: LibraryBook[], filter: AuthorBookFilter, sort: AuthorBookSort): LibraryBook[] {
  const filtered = books.filter(book => {
    if (filter === "MISSING") return !book.owned;
    if (filter === "OWNED") return book.owned;
    if (filter === "READ") return book.status === "READ";
    if (filter === "TO_READ") return book.status !== "READ";
    return true;
  });
  return filtered.sort((a, b) => {
    if (sort === "TITLE") return byTitle(a, b);
    if (sort === "DATE") return (b.publishedYear ?? -1) - (a.publishedYear ?? -1) || byTitle(a, b);
    return Number(a.owned) - Number(b.owned) || byTitle(a, b);
  });
}

/** Works of `remote` that have no counterpart yet in `current`. */
export function findNewWorks(remote: BookSearchResult[], current: LibraryBook[]): BookSearchResult[] {
  return remote.filter(book => !current.some(local => isSameWork(book, local)));
}

/* ---- Formatting ---- */

export function localDateTimeValue(date = new Date()): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

const dateTimeFormat = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" });

export function formatDateTime(value: string): string {
  return dateTimeFormat.format(new Date(value));
}

export function formatRefreshDate(value?: string): string {
  return value ? formatDateTime(value) : "Jamais";
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return count > 1 ? many : one;
}
