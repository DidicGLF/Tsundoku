export type ReadingStatus = "TO_READ" | "READING" | "READ" | "ON_HOLD" | "ABANDONED";
export type BookSourceName = "open-library" | "google-books" | "bnf";

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

export interface LibraryBookUpdate {
  status?: ReadingStatus;
  favorite?: boolean;
  owned?: boolean;
  progressValue?: number;
  progressTotal?: number;
  /** Empty string removes the book from its series. */
  seriesName?: string;
  seriesVolume?: number;
  newlyDiscovered?: boolean;
}

export interface ReadingSession {
  id: string;
  userBookId: string;
  startedAt: string;
  durationMinutes: number;
  startProgress?: number;
  endProgress?: number;
  notes?: string;
  createdAt: string;
}

export interface NewReadingSession {
  startedAt: string;
  durationMinutes: number;
  endProgress?: number;
  notes?: string;
}

export interface FollowedAuthor {
  authorKey: string;
  name: string;
  lastRefreshedAt?: string;
}
