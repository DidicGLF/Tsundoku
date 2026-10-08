import type { SqliteAdapter } from "./adapter";
import type {
  BookSourceName, FollowedAuthor, LibraryBookUpdate, NewLibraryBook, NewReadingSession,
  ReadingSession, ReadingStatus, StoredLibraryBook
} from "./types";

type Row = Record<string, unknown>;

const LOCAL_USER = "local";

export class SqliteLibraryRepository {
  constructor(private readonly db: SqliteAdapter, private readonly userId = LOCAL_USER) {}

  async list(): Promise<StoredLibraryBook[]> {
    const rows = await this.db.query<Row>(
      `SELECT
        ub.id AS id, b.id AS book_id,
        b.title, b.description, b.language, b.source, b.source_id,
        COALESCE(e.cover_url, b.cover_url) AS cover_url,
        COALESCE(e.published_year, b.first_published_year) AS published_year,
        e.publisher, e.isbn10, e.isbn13, e.page_count,
        s.name AS series_name, bs.volume_number AS series_volume,
        ub.status, ub.owned, ub.favorite, ub.newly_discovered, ub.progress_value, ub.progress_total,
        ub.started_at, ub.finished_at, ub.created_at, ub.updated_at
       FROM user_books ub
       JOIN books b ON b.id = ub.book_id
       LEFT JOIN editions e ON e.id = ub.edition_id
       LEFT JOIN book_series bs ON bs.book_id = b.id
       LEFT JOIN series s ON s.id = bs.series_id
       WHERE ub.user_id = ? AND ub.deleted_at IS NULL
       ORDER BY ub.updated_at DESC`,
      [this.userId]
    );

    const authorRows = await this.db.query<{ book_id: string; name: string }>(
      `SELECT ba.book_id, a.name
       FROM book_authors ba
       JOIN authors a ON a.id = ba.author_id
       WHERE ba.book_id IN (SELECT book_id FROM user_books WHERE user_id = ? AND deleted_at IS NULL)
       ORDER BY ba.book_id, ba.position`,
      [this.userId]
    );
    const authorsByBook = new Map<string, string[]>();
    for (const { book_id, name } of authorRows) {
      const list = authorsByBook.get(book_id);
      if (list) list.push(name);
      else authorsByBook.set(book_id, [name]);
    }

    return rows.map(row => ({
      id: String(row.id),
      source: String(row.source) as BookSourceName,
      sourceId: String(row.source_id),
      title: String(row.title),
      authors: authorsByBook.get(String(row.book_id)) ?? [],
      publishedYear: numberOrUndefined(row.published_year),
      publisher: stringOrUndefined(row.publisher),
      isbn10: stringOrUndefined(row.isbn10),
      isbn13: stringOrUndefined(row.isbn13),
      pageCount: numberOrUndefined(row.page_count),
      language: stringOrUndefined(row.language),
      description: stringOrUndefined(row.description),
      coverUrl: stringOrUndefined(row.cover_url),
      status: String(row.status) as ReadingStatus,
      favorite: Boolean(Number(row.favorite)),
      owned: Boolean(Number(row.owned)),
      newlyDiscovered: Boolean(Number(row.newly_discovered)),
      progressValue: numberOrUndefined(row.progress_value),
      progressTotal: numberOrUndefined(row.progress_total),
      startedAt: stringOrUndefined(row.started_at),
      finishedAt: stringOrUndefined(row.finished_at),
      addedAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      seriesName: stringOrUndefined(row.series_name),
      seriesVolume: numberOrUndefined(row.series_volume)
    }));
  }

  /**
   * Adds a book to the library. A book already present (same ISBN or same source id)
   * is kept as is, except that an explicit `owned: true` marks it as owned; a
   * soft-deleted one is restored with a fresh reading state.
   */
  /**
   * Runs several repository calls in one transaction: a single commit (and, on the web,
   * a single write of the database) instead of one per book.
   */
  batch<T>(work: () => Promise<T>): Promise<T> {
    return this.db.transaction(work);
  }

  /**
   * Adds many books at once. Existing data is read once, new books are written with
   * a single native call; books already tracked (or soft-deleted) go through `add`.
   */
  async addMany(inputs: NewLibraryBook[]): Promise<void> {
    if (!inputs.length) return;
    await this.db.transaction(async () => {
      interface Known { id: string; bookId: string; owned: boolean; deleted: boolean }
      const known = new Map<string, Known>();
      const remember = (keys: string[], entry: Known) => {
        for (const key of keys) {
          const previous = known.get(key);
          // A live copy always wins over a soft-deleted one.
          if (!previous || (previous.deleted && !entry.deleted)) known.set(key, entry);
        }
      };
      for (const row of await this.db.query<{
        id: string; book_id: string; owned: number; deleted_at: string | null;
        isbn13: string | null; isbn10: string | null; source: string | null; source_id: string | null
      }>(
        `SELECT ub.id, ub.book_id, ub.owned, ub.deleted_at, e.isbn13, e.isbn10, b.source, b.source_id FROM user_books ub
         JOIN books b ON b.id = ub.book_id LEFT JOIN editions e ON e.id = ub.edition_id WHERE ub.user_id = ?`, [this.userId]
      )) {
        const keys = [row.isbn13, row.isbn10].filter(Boolean).map(isbn => `i:${isbn}`);
        keys.push(`s:${row.source}:${row.source_id}`);
        remember(keys, { id: row.id, bookId: row.book_id, owned: Boolean(Number(row.owned)), deleted: row.deleted_at != null });
      }
      const authors = new Map<string, string>();
      for (const row of await this.db.query<{ id: string; normalized_name: string }>("SELECT id, normalized_name FROM authors")) {
        authors.set(row.normalized_name, row.id);
      }
      const series = new Map<string, string>();
      for (const row of await this.db.query<{ id: string; normalized_name: string }>("SELECT id, normalized_name FROM series")) {
        series.set(row.normalized_name, row.id);
      }

      let pending: Array<{ sql: string; params: unknown[] }> = [];
      const flush = async () => { const batch = pending; pending = []; await this.db.executeMany(batch); };

      for (const input of inputs) {
        const keys = [input.isbn13, input.isbn10].filter(Boolean).map(isbn => `i:${isbn}`);
        keys.push(`s:${input.source}:${input.sourceId}`);
        const entry = keys.map(key => known.get(key)).find(Boolean);
        if (entry) {
          const at = new Date().toISOString();
          if (entry.deleted) {
            pending.push({
              sql: `UPDATE user_books SET
                      status = 'TO_READ', owned = ?, favorite = 0, newly_discovered = ?,
                      progress_value = NULL, progress_total = ?, started_at = NULL, finished_at = NULL,
                      updated_at = ?, deleted_at = NULL
                    WHERE id = ?`,
              params: [(input.owned ?? true) ? 1 : 0, input.newlyDiscovered ? 1 : 0, input.pageCount ?? null, at, entry.id]
            });
            entry.deleted = false;
            entry.owned = (input.owned ?? true);
          } else if (input.owned === true && !entry.owned) {
            pending.push({
              sql: "UPDATE user_books SET owned = 1, newly_discovered = 0, updated_at = ? WHERE id = ? AND owned = 0",
              params: [at, entry.id]
            });
            entry.owned = true;
          }
          if (input.seriesName) {
            await flush();
            await this.applySeries(entry.bookId, input.seriesName, input.seriesVolume, false);
          }
          remember(keys, entry);
          continue;
        }

        const owned = (input.owned ?? true) ? 1 : 0;
        const now = new Date().toISOString();
        const bookId = crypto.randomUUID();
        const editionId = crypto.randomUUID();
        pending.push({
          sql: `INSERT INTO books
                (id,title,description,language,cover_url,first_published_year,source,source_id,created_at,updated_at)
                VALUES(?,?,?,?,?,?,?,?,?,?)`,
          params: [bookId, input.title, input.description ?? null, input.language ?? null, input.coverUrl ?? null,
                   input.publishedYear ?? null, input.source, input.sourceId, now, now]
        }, {
          sql: `INSERT INTO editions
                (id,book_id,title,publisher,published_year,isbn10,isbn13,page_count,language,cover_url,created_at,updated_at)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
          params: [editionId, bookId, input.title, input.publisher ?? null, input.publishedYear ?? null,
                   input.isbn10 ?? null, input.isbn13 ?? null, input.pageCount ?? null, input.language ?? null,
                   input.coverUrl ?? null, now, now]
        });

        let position = 0;
        for (const rawName of input.authors) {
          const name = rawName.trim();
          if (!name) continue;
          const normalized = normalizeName(name);
          let authorId = authors.get(normalized);
          if (!authorId) {
            authorId = crypto.randomUUID();
            authors.set(normalized, authorId);
            pending.push({
              sql: "INSERT INTO authors(id,name,normalized_name,created_at,updated_at) VALUES(?,?,?,?,?)",
              params: [authorId, name, normalized, now, now]
            });
          }
          pending.push({
            sql: "INSERT OR IGNORE INTO book_authors(book_id,author_id,position) VALUES(?,?,?)",
            params: [bookId, authorId, position++]
          });
        }

        const userBookId = crypto.randomUUID();
        remember(keys, { id: userBookId, bookId, owned: owned === 1, deleted: false });
        pending.push({
          sql: `INSERT INTO user_books
                (id,user_id,book_id,edition_id,status,owned,favorite,newly_discovered,progress_total,created_at,updated_at)
                VALUES(?,?,?,?,'TO_READ',?,0,?,?,?,?)`,
          params: [userBookId, this.userId, bookId, editionId, owned, input.newlyDiscovered ? 1 : 0,
                   input.pageCount ?? null, now, now]
        });

        const seriesName = input.seriesName?.trim();
        if (seriesName) {
          const normalized = normalizeName(seriesName);
          let seriesId = series.get(normalized);
          if (!seriesId) {
            seriesId = crypto.randomUUID();
            series.set(normalized, seriesId);
            pending.push({
              sql: "INSERT INTO series(id,name,normalized_name,created_at,updated_at) VALUES(?,?,?,?,?)",
              params: [seriesId, seriesName, normalized, now, now]
            });
          }
          pending.push({
            sql: "INSERT INTO book_series(book_id,series_id,volume_number,created_at,updated_at) VALUES(?,?,?,?,?)",
            params: [bookId, seriesId, input.seriesVolume ?? null, now, now]
          });
        }
      }
      await flush();
    });
  }

  async add(input: NewLibraryBook): Promise<void> {
    await this.db.transaction(async () => {
      const owned = (input.owned ?? true) ? 1 : 0;
      const now = new Date().toISOString();

      const existing = await this.findUserBook(input, false);
      if (existing) {
        if (input.owned === true) {
          await this.db.execute(
            "UPDATE user_books SET owned = 1, newly_discovered = 0, updated_at = ? WHERE id = ? AND owned = 0",
            [now, existing.id]
          );
        }
        await this.applySeries(existing.bookId, input.seriesName, input.seriesVolume, false);
        return;
      }

      const deleted = await this.findUserBook(input, true);
      if (deleted) {
        await this.db.execute(
          `UPDATE user_books SET
             status = 'TO_READ', owned = ?, favorite = 0, newly_discovered = ?,
             progress_value = NULL, progress_total = ?, started_at = NULL, finished_at = NULL,
             updated_at = ?, deleted_at = NULL
           WHERE id = ?`,
          [owned, input.newlyDiscovered ? 1 : 0, input.pageCount ?? null, now, deleted.id]
        );
        await this.applySeries(deleted.bookId, input.seriesName, input.seriesVolume, false);
        return;
      }

      const bookId = crypto.randomUUID();
      const editionId = crypto.randomUUID();
      await this.db.execute(
        `INSERT INTO books
         (id,title,description,language,cover_url,first_published_year,source,source_id,created_at,updated_at)
         VALUES(?,?,?,?,?,?,?,?,?,?)`,
        [bookId, input.title, input.description ?? null, input.language ?? null, input.coverUrl ?? null,
         input.publishedYear ?? null, input.source, input.sourceId, now, now]
      );
      await this.db.execute(
        `INSERT INTO editions
         (id,book_id,title,publisher,published_year,isbn10,isbn13,page_count,language,cover_url,created_at,updated_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
        [editionId, bookId, input.title, input.publisher ?? null, input.publishedYear ?? null,
         input.isbn10 ?? null, input.isbn13 ?? null, input.pageCount ?? null, input.language ?? null,
         input.coverUrl ?? null, now, now]
      );

      let position = 0;
      for (const rawName of input.authors) {
        const name = rawName.trim();
        if (!name) continue;
        const authorId = await this.findOrCreateAuthor(name, now);
        await this.db.execute(
          "INSERT OR IGNORE INTO book_authors(book_id,author_id,position) VALUES(?,?,?)",
          [bookId, authorId, position++]
        );
      }

      await this.db.execute(
        `INSERT INTO user_books
         (id,user_id,book_id,edition_id,status,owned,favorite,newly_discovered,progress_total,created_at,updated_at)
         VALUES(?,?,?,?,'TO_READ',?,0,?,?,?,?)`,
        [crypto.randomUUID(), this.userId, bookId, editionId, owned, input.newlyDiscovered ? 1 : 0,
         input.pageCount ?? null, now, now]
      );
      await this.applySeries(bookId, input.seriesName, input.seriesVolume, false);
    });
  }

  async update(id: string, changes: LibraryBookUpdate): Promise<void> {
    await this.db.transaction(async () => {
      const row = (await this.db.query<Row>(
        "SELECT * FROM user_books WHERE id = ? AND user_id = ? AND deleted_at IS NULL", [id, this.userId]
      ))[0];
      if (!row) throw new Error("Livre introuvable dans la bibliothèque.");

      const previousStatus = String(row.status) as ReadingStatus;
      const status = changes.status ?? previousStatus;
      const now = new Date().toISOString();

      let startedAt = stringOrUndefined(row.started_at);
      let finishedAt = stringOrUndefined(row.finished_at);
      if (status === "READING" && !startedAt) startedAt = now;
      if (status === "READ") {
        if (!startedAt) startedAt = now;
        // Keep the original date when saving an already finished book again.
        if (previousStatus !== "READ" || !finishedAt) finishedAt = now;
      } else if (previousStatus === "READ") {
        finishedAt = undefined;
      }

      await this.db.execute(
        `UPDATE user_books SET
          status = ?, owned = ?, favorite = ?, newly_discovered = ?, progress_value = ?, progress_total = ?,
          started_at = ?, finished_at = ?, updated_at = ?
         WHERE id = ?`,
        [
          status,
          (changes.owned ?? Boolean(Number(row.owned))) ? 1 : 0,
          (changes.favorite ?? Boolean(Number(row.favorite))) ? 1 : 0,
          (changes.newlyDiscovered ?? Boolean(Number(row.newly_discovered))) ? 1 : 0,
          changes.progressValue ?? numberOrUndefined(row.progress_value) ?? null,
          changes.progressTotal ?? numberOrUndefined(row.progress_total) ?? null,
          startedAt ?? null, finishedAt ?? null, now, id
        ]
      );

      if (changes.seriesName !== undefined || changes.seriesVolume !== undefined) {
        await this.applySeries(String(row.book_id), changes.seriesName, changes.seriesVolume, true);
      }
    });
  }

  /** Fills in metadata that is still missing; never overwrites existing values. */
  async refreshMetadata(id: string, input: NewLibraryBook): Promise<void> {
    const row = (await this.db.query<{ book_id: string; edition_id: string | null }>(
      "SELECT book_id, edition_id FROM user_books WHERE id = ? AND user_id = ? AND deleted_at IS NULL LIMIT 1",
      [id, this.userId]
    ))[0];
    if (!row) return;

    const now = new Date().toISOString();
    await this.db.transaction(async () => {
      await this.db.execute(
        `UPDATE books SET
           description = COALESCE(description, ?), language = COALESCE(language, ?),
           cover_url = COALESCE(cover_url, ?), first_published_year = COALESCE(first_published_year, ?),
           updated_at = ?
         WHERE id = ?`,
        [input.description ?? null, input.language ?? null, input.coverUrl ?? null, input.publishedYear ?? null, now, row.book_id]
      );
      if (row.edition_id) {
        await this.db.execute(
          `UPDATE editions SET
             publisher = COALESCE(publisher, ?), published_year = COALESCE(published_year, ?),
             isbn10 = COALESCE(isbn10, ?), isbn13 = COALESCE(isbn13, ?), page_count = COALESCE(page_count, ?),
             language = COALESCE(language, ?), cover_url = COALESCE(cover_url, ?), updated_at = ?
           WHERE id = ?`,
          [input.publisher ?? null, input.publishedYear ?? null, input.isbn10 ?? null, input.isbn13 ?? null,
           input.pageCount ?? null, input.language ?? null, input.coverUrl ?? null, now, row.edition_id]
        );
      }
    });
  }

  async remove(id: string): Promise<void> {
    const now = new Date().toISOString();
    const result = await this.db.execute(
      "UPDATE user_books SET deleted_at = ?, updated_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
      [now, now, id, this.userId]
    );
    if (!result.rowsAffected) throw new Error("Livre introuvable dans la bibliothèque.");
  }

  async listReadingSessions(userBookId: string): Promise<ReadingSession[]> {
    const rows = await this.db.query<Row>(
      "SELECT * FROM reading_sessions WHERE user_book_id = ? AND deleted_at IS NULL ORDER BY started_at DESC",
      [userBookId]
    );
    return rows.map(row => ({
      id: String(row.id),
      userBookId: String(row.user_book_id),
      startedAt: String(row.started_at),
      durationMinutes: Number(row.duration_minutes),
      startProgress: numberOrUndefined(row.start_progress),
      endProgress: numberOrUndefined(row.end_progress),
      notes: stringOrUndefined(row.notes),
      createdAt: String(row.created_at)
    }));
  }

  async addReadingSession(userBookId: string, input: NewReadingSession): Promise<void> {
    if (!Number.isFinite(input.durationMinutes) || input.durationMinutes <= 0) {
      throw new Error("La durée de la session doit être supérieure à 0 minute.");
    }
    await this.db.transaction(async () => {
      const book = (await this.db.query<Row>(
        "SELECT * FROM user_books WHERE id = ? AND user_id = ? AND deleted_at IS NULL LIMIT 1", [userBookId, this.userId]
      ))[0];
      if (!book) throw new Error("Livre introuvable dans la bibliothèque.");

      const startProgress = numberOrUndefined(book.progress_value);
      const endProgress = input.endProgress;
      if (endProgress != null && endProgress < 0) throw new Error("La progression ne peut pas être négative.");
      const total = numberOrUndefined(book.progress_total);
      if (endProgress != null && total != null && endProgress > total) {
        throw new Error(`La progression ne peut pas dépasser ${total}.`);
      }

      const now = new Date().toISOString();
      await this.db.execute(
        `INSERT INTO reading_sessions
         (id,user_book_id,started_at,duration_minutes,start_progress,end_progress,notes,created_at,updated_at)
         VALUES(?,?,?,?,?,?,?,?,?)`,
        [crypto.randomUUID(), userBookId, input.startedAt, Math.round(input.durationMinutes),
         startProgress ?? null, endProgress ?? null, input.notes?.trim() || null, now, now]
      );

      const previous = String(book.status);
      const status = previous === "TO_READ" || previous === "ON_HOLD" ? "READING" : previous;
      await this.db.execute(
        "UPDATE user_books SET status = ?, progress_value = ?, started_at = ?, updated_at = ? WHERE id = ?",
        [status, endProgress ?? startProgress ?? null, stringOrUndefined(book.started_at) ?? input.startedAt, now, userBookId]
      );
    });
  }

  async getFollowedAuthor(authorKey: string): Promise<FollowedAuthor | null> {
    const row = (await this.db.query<Row>(
      "SELECT author_key, name, last_refreshed_at FROM followed_authors WHERE author_key = ? LIMIT 1", [authorKey]
    ))[0];
    if (!row) return null;
    return { authorKey: String(row.author_key), name: String(row.name), lastRefreshedAt: stringOrUndefined(row.last_refreshed_at) };
  }

  async upsertFollowedAuthor(authorKey: string, name: string, refreshedAt: string): Promise<void> {
    const now = new Date().toISOString();
    await this.db.execute(
      `INSERT INTO followed_authors(author_key,name,last_refreshed_at,created_at,updated_at)
       VALUES(?,?,?,?,?)
       ON CONFLICT(author_key) DO UPDATE SET
         name = excluded.name, last_refreshed_at = excluded.last_refreshed_at, updated_at = excluded.updated_at`,
      [authorKey, name, refreshedAt, now, now]
    );
  }

  async removeFollowedAuthor(authorKey: string): Promise<void> {
    await this.db.execute("DELETE FROM followed_authors WHERE author_key = ?", [authorKey]);
  }

  private async findOrCreateAuthor(name: string, now: string): Promise<string> {
    const normalized = normalizeName(name);
    const found = await this.db.query<{ id: string }>("SELECT id FROM authors WHERE normalized_name = ? LIMIT 1", [normalized]);
    if (found[0]) return found[0].id;
    const id = crypto.randomUUID();
    await this.db.execute(
      "INSERT INTO authors(id,name,normalized_name,created_at,updated_at) VALUES(?,?,?,?,?)",
      [id, name, normalized, now, now]
    );
    return id;
  }

  /**
   * Links a book to a series. `replace` (explicit edit) overwrites the volume and an
   * empty name unlinks the book; otherwise (import) an unknown volume keeps the old one.
   */
  private async applySeries(bookId: string, seriesName: string | undefined, seriesVolume: number | undefined, replace: boolean): Promise<void> {
    const current = (await this.db.query<{ name: string; volume_number: number | null }>(
      `SELECT s.name, bs.volume_number FROM book_series bs JOIN series s ON s.id = bs.series_id
       WHERE bs.book_id = ? LIMIT 1`, [bookId]
    ))[0];

    const name = (seriesName ?? (replace ? current?.name : undefined) ?? "").trim();
    if (!name) {
      if (replace && seriesName !== undefined) await this.db.execute("DELETE FROM book_series WHERE book_id = ?", [bookId]);
      return;
    }

    const now = new Date().toISOString();
    const normalized = normalizeName(name);
    const found = await this.db.query<{ id: string }>("SELECT id FROM series WHERE normalized_name = ? LIMIT 1", [normalized]);
    const seriesId = found[0]?.id ?? crypto.randomUUID();
    if (!found.length) {
      await this.db.execute(
        "INSERT INTO series(id,name,normalized_name,created_at,updated_at) VALUES(?,?,?,?,?)",
        [seriesId, name, normalized, now, now]
      );
    }
    const volume = seriesVolume ?? numberOrUndefined(current?.volume_number);
    await this.db.execute(
      `INSERT INTO book_series(book_id,series_id,volume_number,created_at,updated_at) VALUES(?,?,?,?,?)
       ON CONFLICT(book_id) DO UPDATE SET
         series_id = excluded.series_id, volume_number = excluded.volume_number, updated_at = excluded.updated_at`,
      [bookId, seriesId, volume ?? null, now, now]
    );
  }

  /** Finds the user's copy of a book by ISBN first, then by source id. */
  private async findUserBook(input: NewLibraryBook, deleted: boolean): Promise<{ id: string; bookId: string } | undefined> {
    const state = deleted ? "ub.deleted_at IS NOT NULL" : "ub.deleted_at IS NULL";
    const isbns = [input.isbn13, input.isbn10].filter((isbn): isbn is string => Boolean(isbn));
    if (isbns.length) {
      const marks = isbns.map(() => "?").join(",");
      const byIsbn = await this.db.query<{ id: string; book_id: string }>(
        `SELECT ub.id, ub.book_id FROM user_books ub JOIN editions e ON e.id = ub.edition_id
         WHERE ub.user_id = ? AND ${state} AND (e.isbn13 IN (${marks}) OR e.isbn10 IN (${marks}))
         ORDER BY ub.updated_at DESC LIMIT 1`,
        [this.userId, ...isbns, ...isbns]
      );
      if (byIsbn[0]) return { id: byIsbn[0].id, bookId: byIsbn[0].book_id };
    }
    const bySource = await this.db.query<{ id: string; book_id: string }>(
      `SELECT ub.id, ub.book_id FROM user_books ub JOIN books b ON b.id = ub.book_id
       WHERE ub.user_id = ? AND ${state} AND b.source = ? AND b.source_id = ?
       ORDER BY ub.updated_at DESC LIMIT 1`,
      [this.userId, input.source, input.sourceId]
    );
    return bySource[0] ? { id: bySource[0].id, bookId: bySource[0].book_id } : undefined;
  }
}

/** Accent-free, lowercase, letters-and-digits-only key (any script) used to match authors and series. */
export function normalizeName(name: string): string {
  return name.normalize("NFD").replace(/\p{M}+/gu, "").toLocaleLowerCase("fr").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function stringOrUndefined(v: unknown): string | undefined { return v == null ? undefined : String(v); }
function numberOrUndefined(v: unknown): number | undefined { return v == null ? undefined : Number(v); }
