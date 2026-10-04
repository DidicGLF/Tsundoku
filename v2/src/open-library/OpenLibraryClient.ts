import type { BookMetadata, BookSearchResult, BookSource } from "../types";
import { getJson } from "../http";
import { mapOpenLibraryDoc, mapOpenLibraryWork } from "./mapper";

interface SearchResponse { docs?: SearchDoc[]; }
interface SearchDoc {
  key?: string; title?: string; author_name?: string[]; first_publish_year?: number;
  publisher?: string[]; isbn?: string[]; number_of_pages_median?: number;
  language?: string[]; cover_i?: number; first_sentence?: string | string[];
}
interface WorkResponse {
  key?: string; title?: string; description?: string | { value?: string };
  first_publish_date?: string; covers?: number[];
}

export class OpenLibraryClient implements BookSource {
  readonly id = "open-library" as const;

  constructor(private readonly baseUrl = "https://openlibrary.org") {}

  async search(query: string): Promise<BookSearchResult[]> {
    const normalized = query.trim();
    if (!normalized) return [];
    const params = new URLSearchParams({
      q: normalized, limit: "20",
      fields: "key,title,author_name,first_publish_year,publisher,isbn,number_of_pages_median,language,cover_i,first_sentence"
    });
    const data = await getJson<SearchResponse>(`${this.baseUrl}/search.json?${params}`);
    return (data.docs ?? []).map(mapOpenLibraryDoc);
  }

  async getBook(id: string): Promise<BookMetadata> {
    const normalized = id.trim();
    if (!normalized) throw new Error("Open Library work id cannot be empty.");
    const key = normalized.startsWith("/") ? normalized : `/works/${normalized.replace(/^works\//, "")}`;
    const data = await getJson<WorkResponse>(`${this.baseUrl}${key}.json`);
    return mapOpenLibraryWork(data, key);
  }
}
