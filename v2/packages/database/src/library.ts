import type { SqliteAdapter } from "./adapter";

export type ReadingStatus = "TO_READ" | "READING" | "READ" | "ON_HOLD" | "ABANDONED";

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
  status: ReadingStatus;
  favorite: boolean;
  owned: boolean;
  progressValue?: number;
  progressTotal?: number;
  startedAt?: string;
  finishedAt?: string;
  addedAt: string;
  updatedAt: string;
}

export interface LibraryBookUpdate {
  status?: ReadingStatus;
  favorite?: boolean;
  owned?: boolean;
  progressValue?: number;
  progressTotal?: number;
}

export interface LibraryRepository {
  list(): Promise<StoredLibraryBook[]>;
  add(book: StoredLibraryBook): Promise<void>;
  update(id: string, changes: LibraryBookUpdate): Promise<void>;
}

export class SqliteLibraryRepository implements LibraryRepository {
  constructor(private readonly db: SqliteAdapter) {}

  async list(): Promise<StoredLibraryBook[]> {
    const rows = await this.db.query<Record<string, unknown>>(
      "SELECT * FROM library_books WHERE deleted_at IS NULL ORDER BY updated_at DESC, added_at DESC"
    );
    return rows.map(mapRow);
  }

  async add(b: StoredLibraryBook): Promise<void> {
    await this.db.execute(`INSERT OR IGNORE INTO library_books
      (id,source,source_id,title,authors_json,published_year,publisher,isbn10,isbn13,page_count,language,
       description,cover_url,status,added_at,deleted_at,favorite,owned,progress_value,progress_total,
       started_at,finished_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [b.id,b.source,b.sourceId,b.title,JSON.stringify(b.authors),b.publishedYear??null,b.publisher??null,
       b.isbn10??null,b.isbn13??null,b.pageCount??null,b.language??null,b.description??null,b.coverUrl??null,
       b.status,b.addedAt,null,b.favorite?1:0,b.owned?1:0,b.progressValue??null,b.progressTotal??null,
       b.startedAt??null,b.finishedAt??null,b.updatedAt]);
  }

  async update(id: string, changes: LibraryBookUpdate): Promise<void> {
    const current = await this.db.query<Record<string, unknown>>(
      "SELECT * FROM library_books WHERE id = ? AND deleted_at IS NULL",
      [id]
    );
    if (!current.length) throw new Error("Livre introuvable dans la bibliothèque.");

    const book = mapRow(current[0]);
    const status = changes.status ?? book.status;
    const now = new Date().toISOString();

    let startedAt = book.startedAt;
    let finishedAt = book.finishedAt;
    if (status === "READING" && !startedAt) startedAt = now;
    if (status === "READ") {
      if (!startedAt) startedAt = now;
      finishedAt = now;
    } else if (book.status === "READ") {
      finishedAt = undefined;
    }

    await this.db.execute(
      `UPDATE library_books SET
        status = ?, favorite = ?, owned = ?, progress_value = ?, progress_total = ?,
        started_at = ?, finished_at = ?, updated_at = ?
       WHERE id = ?`,
      [
        status,
        (changes.favorite ?? book.favorite) ? 1 : 0,
        (changes.owned ?? book.owned) ? 1 : 0,
        changes.progressValue ?? book.progressValue ?? null,
        changes.progressTotal ?? book.progressTotal ?? null,
        startedAt ?? null,
        finishedAt ?? null,
        now,
        id
      ]
    );
  }
}

function mapRow(r: Record<string, unknown>): StoredLibraryBook {
  return {
    id: String(r.id),
    source: r.source as StoredLibraryBook["source"],
    sourceId: String(r.source_id),
    title: String(r.title),
    authors: JSON.parse(String(r.authors_json || "[]")),
    publishedYear: numberOrUndefined(r.published_year),
    publisher: stringOrUndefined(r.publisher),
    isbn10: stringOrUndefined(r.isbn10),
    isbn13: stringOrUndefined(r.isbn13),
    pageCount: numberOrUndefined(r.page_count),
    language: stringOrUndefined(r.language),
    description: stringOrUndefined(r.description),
    coverUrl: stringOrUndefined(r.cover_url),
    status: (r.status || "TO_READ") as ReadingStatus,
    favorite: Boolean(Number(r.favorite ?? 0)),
    owned: Boolean(Number(r.owned ?? 1)),
    progressValue: numberOrUndefined(r.progress_value),
    progressTotal: numberOrUndefined(r.progress_total),
    startedAt: stringOrUndefined(r.started_at),
    finishedAt: stringOrUndefined(r.finished_at),
    addedAt: String(r.added_at),
    updatedAt: String(r.updated_at || r.added_at)
  };
}

function stringOrUndefined(v: unknown) { return v == null ? undefined : String(v); }
function numberOrUndefined(v: unknown) { return v == null ? undefined : Number(v); }
