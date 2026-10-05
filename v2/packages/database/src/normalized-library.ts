import type { SqliteAdapter } from "./adapter";
import type { ReadingStatus, StoredLibraryBook, LibraryBookUpdate } from "./library";

export interface NewNormalizedLibraryBook {
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
}

export class SqliteNormalizedLibraryRepository {
  constructor(private readonly db: SqliteAdapter) {}

  async list(userId = "local"): Promise<StoredLibraryBook[]> {
    const rows = await this.db.query<Record<string, unknown>>(
      `SELECT
        ub.id AS id, b.id AS book_id, e.id AS edition_id,
        b.title, b.description, b.language,
        COALESCE(e.cover_url, b.cover_url) AS cover_url,
        COALESCE(e.published_year, b.first_published_year) AS published_year,
        e.publisher, e.isbn10, e.isbn13, e.page_count,
        b.openlibrary_work_id, b.google_books_id,
        ub.status, ub.owned, ub.favorite, ub.progress_value, ub.progress_total,
        ub.started_at, ub.finished_at, ub.created_at, ub.updated_at
       FROM user_books ub
       JOIN books b ON b.id = ub.book_id
       LEFT JOIN editions e ON e.id = ub.edition_id
       WHERE ub.user_id = ? AND ub.deleted_at IS NULL AND b.deleted_at IS NULL
       ORDER BY ub.updated_at DESC`,
      [userId]
    );

    const result: StoredLibraryBook[] = [];
    for (const row of rows) {
      const authors = await this.db.query<{ name: string }>(
        `SELECT a.name
         FROM book_authors ba
         JOIN authors a ON a.id = ba.author_id
         WHERE ba.book_id = ? AND a.deleted_at IS NULL
         ORDER BY ba.position`,
        [String(row.book_id)]
      );

      const openLibraryId = stringOrUndefined(row.openlibrary_work_id);
      const googleBooksId = stringOrUndefined(row.google_books_id);
      const source = googleBooksId ? "google-books" : "open-library";
      const sourceId = googleBooksId ?? openLibraryId ?? String(row.book_id);

      result.push({
        id: String(row.id),
        source,
        sourceId,
        title: String(row.title),
        authors: authors.map(a => a.name),
        publishedYear: numberOrUndefined(row.published_year),
        publisher: stringOrUndefined(row.publisher),
        isbn10: stringOrUndefined(row.isbn10),
        isbn13: stringOrUndefined(row.isbn13),
        pageCount: numberOrUndefined(row.page_count),
        language: stringOrUndefined(row.language),
        description: stringOrUndefined(row.description),
        coverUrl: stringOrUndefined(row.cover_url),
        status: String(row.status) as ReadingStatus,
        favorite: Boolean(Number(row.favorite ?? 0)),
        owned: Boolean(Number(row.owned ?? 0)),
        progressValue: numberOrUndefined(row.progress_value),
        progressTotal: numberOrUndefined(row.progress_total),
        startedAt: stringOrUndefined(row.started_at),
        finishedAt: stringOrUndefined(row.finished_at),
        addedAt: String(row.created_at),
        updatedAt: String(row.updated_at)
      });
    }
    return result;
  }

  async add(input: NewNormalizedLibraryBook, userId = "local"): Promise<void> {
    await this.db.transaction(async () => {
      const existing = await this.findExisting(input, userId);
      if (existing) return;

      const now = new Date().toISOString();
      const bookId = crypto.randomUUID();
      const editionId = crypto.randomUUID();
      const userBookId = crypto.randomUUID();

      await this.db.execute(
        `INSERT INTO books
         (id,title,original_title,description,language,cover_url,first_published_year,
          openlibrary_work_id,google_books_id,created_at,updated_at,deleted_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,NULL)`,
        [
          bookId, input.title, null, input.description ?? null, input.language ?? null,
          input.coverUrl ?? null, input.publishedYear ?? null,
          input.source === "open-library" ? input.sourceId : null,
          input.source === "google-books" ? input.sourceId : null,
          now, now
        ]
      );

      await this.db.execute(
        `INSERT INTO editions
         (id,book_id,title,publisher,published_year,isbn10,isbn13,page_count,language,cover_url,
          openlibrary_edition_id,google_books_id,created_at,updated_at,deleted_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)`,
        [
          editionId, bookId, input.title, input.publisher ?? null, input.publishedYear ?? null,
          input.isbn10 ?? null, input.isbn13 ?? null, input.pageCount ?? null, input.language ?? null,
          input.coverUrl ?? null, null, input.source === "google-books" ? input.sourceId : null,
          now, now
        ]
      );

      for (let position = 0; position < input.authors.length; position++) {
        const name = input.authors[position].trim();
        if (!name) continue;
        const normalized = normalizeName(name);
        const found = await this.db.query<{ id: string }>(
          "SELECT id FROM authors WHERE normalized_name = ? AND deleted_at IS NULL LIMIT 1",
          [normalized]
        );
        const authorId = found[0]?.id ?? crypto.randomUUID();

        if (!found.length) {
          await this.db.execute(
            `INSERT INTO authors
             (id,name,normalized_name,openlibrary_author_id,created_at,updated_at,deleted_at)
             VALUES(?,?,?,?,?,?,NULL)`,
            [authorId, name, normalized, null, now, now]
          );
        }

        await this.db.execute(
          "INSERT OR IGNORE INTO book_authors(book_id,author_id,position) VALUES(?,?,?)",
          [bookId, authorId, position]
        );
      }

      await this.db.execute(
        `INSERT INTO user_books
         (id,user_id,book_id,edition_id,status,owned,rating,review,progress_type,progress_value,
          progress_total,started_at,finished_at,favorite,notes,created_at,updated_at,deleted_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)`,
        [
          userBookId, userId, bookId, editionId, "TO_READ", 1, null, null, "pages", null,
          input.pageCount ?? null, null, null, 0, null, now, now
        ]
      );
    });
  }

  async remove(id: string): Promise<void> {
    const rows = await this.db.query<{ id: string }>(
      "SELECT id FROM user_books WHERE id = ? AND deleted_at IS NULL LIMIT 1",
      [id]
    );
    if (!rows.length) throw new Error("Livre introuvable dans la bibliothèque.");

    const now = new Date().toISOString();
    await this.db.execute(
      "UPDATE user_books SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL",
      [now, now, id]
    );
  }

  async update(id: string, changes: LibraryBookUpdate): Promise<void> {
    const rows = await this.db.query<Record<string, unknown>>(
      "SELECT * FROM user_books WHERE id = ? AND deleted_at IS NULL",
      [id]
    );
    if (!rows.length) throw new Error("Livre introuvable dans la bibliothèque.");

    const row = rows[0];
    const previousStatus = String(row.status) as ReadingStatus;
    const status = changes.status ?? previousStatus;
    const now = new Date().toISOString();

    let startedAt = stringOrUndefined(row.started_at);
    let finishedAt = stringOrUndefined(row.finished_at);
    if (status === "READING" && !startedAt) startedAt = now;
    if (status === "READ") {
      if (!startedAt) startedAt = now;
      finishedAt = now;
    } else if (previousStatus === "READ") {
      finishedAt = undefined;
    }

    await this.db.execute(
      `UPDATE user_books SET
        status = ?, owned = ?, favorite = ?, progress_value = ?, progress_total = ?,
        started_at = ?, finished_at = ?, updated_at = ?
       WHERE id = ?`,
      [
        status,
        (changes.owned ?? Boolean(Number(row.owned))) ? 1 : 0,
        (changes.favorite ?? Boolean(Number(row.favorite))) ? 1 : 0,
        changes.progressValue ?? numberOrUndefined(row.progress_value) ?? null,
        changes.progressTotal ?? numberOrUndefined(row.progress_total) ?? null,
        startedAt ?? null, finishedAt ?? null, now, id
      ]
    );
  }

  private async findExisting(input: NewNormalizedLibraryBook, userId: string): Promise<string | undefined> {
    if (input.isbn13 || input.isbn10) {
      const byIsbn = await this.db.query<{ id: string }>(
        `SELECT ub.id
         FROM user_books ub
         JOIN editions e ON e.id = ub.edition_id
         WHERE ub.user_id = ? AND ub.deleted_at IS NULL
           AND ((? IS NOT NULL AND e.isbn13 = ?) OR (? IS NOT NULL AND e.isbn10 = ?))
         LIMIT 1`,
        [userId, input.isbn13 ?? null, input.isbn13 ?? null, input.isbn10 ?? null, input.isbn10 ?? null]
      );
      if (byIsbn[0]) return byIsbn[0].id;
    }

    const column = input.source === "google-books" ? "google_books_id" : "openlibrary_work_id";
    const bySource = await this.db.query<{ id: string }>(
      `SELECT ub.id
       FROM user_books ub JOIN books b ON b.id = ub.book_id
       WHERE ub.user_id = ? AND ub.deleted_at IS NULL AND b.${column} = ?
       LIMIT 1`,
      [userId, input.sourceId]
    );
    return bySource[0]?.id;
  }
}

function normalizeName(name: string): string {
  return name.trim().toLocaleLowerCase("fr").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
function stringOrUndefined(v: unknown) { return v == null ? undefined : String(v); }
function numberOrUndefined(v: unknown) { return v == null ? undefined : Number(v); }
