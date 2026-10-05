import type { SqliteAdapter } from "./adapter";

export interface StoredLibraryBook {
  id: string;
  source: "open-library" | "google-books";
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
  status: "TO_READ" | "READING" | "READ";
  addedAt: string;
}

export interface LibraryRepository {
  list(): Promise<StoredLibraryBook[]>;
  add(book: StoredLibraryBook): Promise<void>;
}

export class SqliteLibraryRepository implements LibraryRepository {
  constructor(private readonly db: SqliteAdapter) {}

  async list(): Promise<StoredLibraryBook[]> {
    const rows = await this.db.query<Record<string, unknown>>(
      "SELECT * FROM library_books WHERE deleted_at IS NULL ORDER BY added_at DESC"
    );
    return rows.map((r) => ({
      id: String(r.id), source: r.source as StoredLibraryBook["source"], sourceId: String(r.source_id),
      title: String(r.title), authors: JSON.parse(String(r.authors_json || "[]")),
      publishedYear: numberOrUndefined(r.published_year), publisher: stringOrUndefined(r.publisher),
      isbn10: stringOrUndefined(r.isbn10), isbn13: stringOrUndefined(r.isbn13),
      pageCount: numberOrUndefined(r.page_count), language: stringOrUndefined(r.language),
      description: stringOrUndefined(r.description), coverUrl: stringOrUndefined(r.cover_url),
      status: r.status as StoredLibraryBook["status"], addedAt: String(r.added_at)
    }));
  }

  async add(b: StoredLibraryBook): Promise<void> {
    await this.db.execute(`INSERT OR IGNORE INTO library_books
      (id,source,source_id,title,authors_json,published_year,publisher,isbn10,isbn13,page_count,language,description,cover_url,status,added_at,deleted_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)`,
      [b.id,b.source,b.sourceId,b.title,JSON.stringify(b.authors),b.publishedYear??null,b.publisher??null,
       b.isbn10??null,b.isbn13??null,b.pageCount??null,b.language??null,b.description??null,b.coverUrl??null,b.status,b.addedAt]);
  }
}
function stringOrUndefined(v: unknown) { return v == null ? undefined : String(v); }
function numberOrUndefined(v: unknown) { return v == null ? undefined : Number(v); }
