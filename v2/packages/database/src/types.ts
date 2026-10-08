export type ReadingStatus = "TO_READ" | "READING" | "READ" | "ON_HOLD" | "ABANDONED";
export type BookSourceName = "open-library" | "google-books" | "bnf" | "manual";

/** A book of the user's library, flattened from books + editions + user_books. */
export interface StoredLibraryBook {
  /** user_books.id */
  id: string;
  source: BookSourceName;
  sourceId: string;
  title: string;
  authors: string[];
  publishedYear?: number;
  publisher?: string;
  isbn10?: string;
  isbn13?: string;
  pageCount?: number;
  language?: string;
  description?: string;
  coverUrl?: string;
  status: ReadingStatus;
  favorite: boolean;
  owned: boolean;
  /** Star rating from 1 to 5; undefined when not rated. */
  rating?: number;
  progressValue?: number;
  progressTotal?: number;
  startedAt?: string;
  finishedAt?: string;
  addedAt: string;
  updatedAt: string;
  seriesName?: string;
  seriesVolume?: number;
  newlyDiscovered: boolean;
}

export interface NewLibraryBook {
  source: BookSourceName;
  sourceId: string;
  title: string;
  authors: string[];
  publishedYear?: number;
  publisher?: string;
  isbn10?: string;
  isbn13?: string;
  pageCount?: number;
  language?: string;
  description?: string;
  coverUrl?: string;
  seriesName?: string;
  seriesVolume?: number;
  /** Defaults to true. Passing true on a book already tracked as "not owned" marks it owned. */
  owned?: boolean;
  newlyDiscovered?: boolean;
}

/** The edition a user actually owns. Provided values replace the stored ones; `coverUrl: null` clears the cover. */
export interface EditionUpdate {
  isbn10?: string;
  isbn13?: string;
  publisher?: string;
  publishedYear?: number;
  pageCount?: number;
  language?: string;
  coverUrl?: string | null;
}

export interface LibraryBookUpdate {
  status?: ReadingStatus;
  favorite?: boolean;
  owned?: boolean;
  /** 1–5 stars; null removes the rating. */
  rating?: number | null;
  progressValue?: number;
  progressTotal?: number;
  /** Empty string removes the book from its series. */
  seriesName?: string;
  seriesVolume?: number;
  newlyDiscovered?: boolean;
}

export interface FollowedAuthor {
  authorKey: string;
  name: string;
  lastRefreshedAt?: string;
}
