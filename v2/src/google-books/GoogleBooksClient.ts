import type { BookMetadata, BookSearchResult, BookSource, GoogleBooksApiKeyProvider } from "../types";
import { getJson } from "../http";
import { mapGoogleBook } from "./mapper";

export interface GoogleBooksVolume {
  id: string;
  volumeInfo?: {
    title?: string;
    authors?: string[];
    description?: string;
    publishedDate?: string;
    publisher?: string;
    pageCount?: number;
    language?: string;
    industryIdentifiers?: Array<{ type?: string; identifier?: string }>;
    imageLinks?: { thumbnail?: string; smallThumbnail?: string };
  };
}

interface GoogleBooksResponse { items?: GoogleBooksVolume[]; }

export class GoogleBooksClient implements BookSource {
  readonly id = "google-books" as const;

  constructor(
    private readonly apiKeyProvider: GoogleBooksApiKeyProvider,
    private readonly baseUrl = "https://www.googleapis.com/books/v1"
  ) {}

  async search(query: string): Promise<BookSearchResult[]> {
    const normalized = query.trim();
    if (!normalized) return [];
    const params = new URLSearchParams({ q: normalized, maxResults: "20", printType: "books" });
    const key = await this.apiKeyProvider.getGoogleBooksApiKey();
    if (key) params.set("key", key);
    const data = await getJson<GoogleBooksResponse>(`${this.baseUrl}/volumes?${params}`);
    return (data.items ?? []).map(mapGoogleBook);
  }

  async getBook(id: string): Promise<BookMetadata> {
    const normalized = id.trim();
    if (!normalized) throw new Error("Google Books volume id cannot be empty.");
    const params = new URLSearchParams();
    const key = await this.apiKeyProvider.getGoogleBooksApiKey();
    if (key) params.set("key", key);
    const suffix = params.toString() ? `?${params}` : "";
    const data = await getJson<GoogleBooksVolume>(
      `${this.baseUrl}/volumes/${encodeURIComponent(normalized)}${suffix}`
    );
    return mapGoogleBook(data);
  }
}
