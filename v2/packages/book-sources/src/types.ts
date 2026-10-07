export type BookSourceId = "open-library" | "google-books" | "bnf";
export type BookSearchLanguage = "all" | "fr" | "en" | "de" | "es" | "it";
export type BookSearchField = "all" | "title" | "author" | "isbn";

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
  seriesName?: string;
  seriesVolume?: number;
}
export interface BookMetadata extends BookSearchResult { publishedDate?: string; originalTitle?: string; }
export interface BookSource {
  readonly id: BookSourceId;
  search(query: string, language?: BookSearchLanguage, offset?: number, field?: BookSearchField): Promise<BookSearchResult[]>;
  getBook(id: string): Promise<BookMetadata>;
}
export interface GoogleBooksApiKeyProvider { getGoogleBooksApiKey(): Promise<string | null>; }
