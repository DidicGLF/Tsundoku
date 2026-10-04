export type BookSourceId = "open-library" | "google-books";

export interface BookSearchResult {
  source: BookSourceId;
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
}

export interface BookMetadata extends BookSearchResult {
  originalTitle?: string;
  publishedDate?: string;
}

export interface BookSource {
  readonly id: BookSourceId;
  search(query: string): Promise<BookSearchResult[]>;
  getBook(id: string): Promise<BookMetadata>;
}

export interface GoogleBooksApiKeyProvider {
  getGoogleBooksApiKey(): Promise<string | null>;
}
