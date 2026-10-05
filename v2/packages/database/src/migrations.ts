import type { SqliteAdapter } from "./adapter";

const VERSION = 4;

const baseStatements = [
  `CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS books (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    original_title TEXT,
    description TEXT,
    language TEXT,
    cover_url TEXT,
    first_published_year INTEGER,
    openlibrary_work_id TEXT,
    google_books_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS user_books (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    book_id TEXT NOT NULL,
    edition_id TEXT,
    status TEXT NOT NULL,
    owned INTEGER NOT NULL DEFAULT 0,
    rating INTEGER,
    review TEXT,
    progress_type TEXT,
    progress_value REAL,
    progress_total REAL,
    started_at TEXT,
    finished_at TEXT,
    favorite INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS library_books (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    source_id TEXT NOT NULL,
    title TEXT NOT NULL,
    authors_json TEXT NOT NULL DEFAULT '[]',
    published_year INTEGER,
    publisher TEXT,
    isbn10 TEXT,
    isbn13 TEXT,
    page_count INTEGER,
    language TEXT,
    description TEXT,
    cover_url TEXT,
    status TEXT NOT NULL DEFAULT 'TO_READ',
    added_at TEXT NOT NULL,
    deleted_at TEXT,
    favorite INTEGER NOT NULL DEFAULT 0,
    owned INTEGER NOT NULL DEFAULT 1,
    progress_value REAL,
    progress_total REAL,
    started_at TEXT,
    finished_at TEXT,
    updated_at TEXT,
    UNIQUE(source, source_id)
  )`,
  `CREATE TABLE IF NOT EXISTS authors (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    normalized_name TEXT NOT NULL,
    openlibrary_author_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS editions (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL,
    title TEXT,
    publisher TEXT,
    published_year INTEGER,
    isbn10 TEXT,
    isbn13 TEXT,
    page_count INTEGER,
    language TEXT,
    cover_url TEXT,
    openlibrary_edition_id TEXT,
    google_books_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    FOREIGN KEY(book_id) REFERENCES books(id)
  )`,
  `CREATE TABLE IF NOT EXISTS book_authors (
    book_id TEXT NOT NULL,
    author_id TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(book_id, author_id),
    FOREIGN KEY(book_id) REFERENCES books(id),
    FOREIGN KEY(author_id) REFERENCES authors(id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_user_books_user ON user_books(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_user_books_book ON user_books(book_id)`,
  `CREATE INDEX IF NOT EXISTS idx_library_books_added ON library_books(added_at)`,
  `CREATE INDEX IF NOT EXISTS idx_authors_normalized_name ON authors(normalized_name)`,
  `CREATE INDEX IF NOT EXISTS idx_editions_book ON editions(book_id)`,
  `CREATE INDEX IF NOT EXISTS idx_editions_isbn13 ON editions(isbn13)`,
  `CREATE INDEX IF NOT EXISTS idx_editions_isbn10 ON editions(isbn10)`
];

const libraryColumns: Array<[string, string]> = [
  ["favorite", "INTEGER NOT NULL DEFAULT 0"],
  ["owned", "INTEGER NOT NULL DEFAULT 1"],
  ["progress_value", "REAL"],
  ["progress_total", "REAL"],
  ["started_at", "TEXT"],
  ["finished_at", "TEXT"],
  ["updated_at", "TEXT"]
];

async function columnNames(db: SqliteAdapter, table: string): Promise<Set<string>> {
  const rows = await db.query<{ name: string }>(`PRAGMA table_info(${table})`);
  return new Set(rows.map(row => String(row.name)));
}

function uuid(): string {
  return crypto.randomUUID();
}

function normalizedName(name: string): string {
  return name.trim().toLocaleLowerCase("fr").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function parseAuthors(value: unknown): string[] {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

async function migrateLegacyLibrary(db: SqliteAdapter): Promise<void> {
  const legacy = await db.query<Record<string, unknown>>(
    `SELECT * FROM library_books
     WHERE deleted_at IS NULL
       AND id NOT IN (SELECT id FROM user_books)`
  );

  for (const row of legacy) {
    const now = String(row.updated_at || row.added_at || new Date().toISOString());
    const bookId = uuid();
    const editionId = uuid();
    const userBookId = String(row.id);
    const source = String(row.source);
    const sourceId = String(row.source_id);

    await db.execute(
      `INSERT INTO books
       (id,title,description,language,cover_url,first_published_year,openlibrary_work_id,google_books_id,created_at,updated_at,deleted_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,NULL)`,
      [
        bookId,
        String(row.title),
        row.description ?? null,
        row.language ?? null,
        row.cover_url ?? null,
        row.published_year ?? null,
        source === "open-library" ? sourceId : null,
        source === "google-books" ? sourceId : null,
        String(row.added_at),
        now
      ]
    );

    await db.execute(
      `INSERT INTO editions
       (id,book_id,title,publisher,published_year,isbn10,isbn13,page_count,language,cover_url,
        openlibrary_edition_id,google_books_id,created_at,updated_at,deleted_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)`,
      [
        editionId, bookId, String(row.title), row.publisher ?? null, row.published_year ?? null,
        row.isbn10 ?? null, row.isbn13 ?? null, row.page_count ?? null, row.language ?? null,
        row.cover_url ?? null, null, source === "google-books" ? sourceId : null,
        String(row.added_at), now
      ]
    );

    const authors = parseAuthors(row.authors_json);
    for (let position = 0; position < authors.length; position++) {
      const name = authors[position];
      const normalized = normalizedName(name);
      const existing = await db.query<{ id: string }>(
        `SELECT id FROM authors WHERE normalized_name = ? AND deleted_at IS NULL LIMIT 1`,
        [normalized]
      );
      const authorId = existing[0]?.id ?? uuid();

      if (!existing.length) {
        await db.execute(
          `INSERT INTO authors
           (id,name,normalized_name,openlibrary_author_id,created_at,updated_at,deleted_at)
           VALUES(?,?,?,?,?,?,NULL)`,
          [authorId, name, normalized, null, String(row.added_at), now]
        );
      }

      await db.execute(
        `INSERT OR IGNORE INTO book_authors(book_id,author_id,position) VALUES(?,?,?)`,
        [bookId, authorId, position]
      );
    }

    await db.execute(
      `INSERT INTO user_books
       (id,user_id,book_id,edition_id,status,owned,rating,review,progress_type,progress_value,progress_total,
        started_at,finished_at,favorite,notes,created_at,updated_at,deleted_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)`,
      [
        userBookId, "local", bookId, editionId, String(row.status || "TO_READ"),
        Number(row.owned ?? 1), null, null, "pages", row.progress_value ?? null,
        row.progress_total ?? row.page_count ?? null, row.started_at ?? null, row.finished_at ?? null,
        Number(row.favorite ?? 0), null, String(row.added_at), now
      ]
    );
  }
}

export async function runMigrations(db: SqliteAdapter): Promise<void> {
  await db.transaction(async () => {
    await db.execute(baseStatements[0]);

    for (const sql of baseStatements.slice(1)) {
      await db.execute(sql);
    }

    const columns = await columnNames(db, "library_books");
    for (const [name, definition] of libraryColumns) {
      if (!columns.has(name)) {
        await db.execute(`ALTER TABLE library_books ADD COLUMN ${name} ${definition}`);
      }
    }

    await db.execute("UPDATE library_books SET updated_at = COALESCE(updated_at, added_at)");

    const applied = await db.query<{ version: number }>(
      "SELECT version FROM schema_migrations WHERE version = ?",
      [VERSION]
    );

    if (!applied.length) {
      await migrateLegacyLibrary(db);
      await db.execute(
        "INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)",
        [VERSION, new Date().toISOString()]
      );
    }
  });
}
