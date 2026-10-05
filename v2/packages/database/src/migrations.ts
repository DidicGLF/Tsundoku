import type { SqliteAdapter } from "./adapter";

const VERSION = 3;

const baseStatements = [
  `CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS books (
    id TEXT PRIMARY KEY,title TEXT NOT NULL,original_title TEXT,description TEXT,language TEXT,cover_url TEXT,
    first_published_year INTEGER,openlibrary_work_id TEXT,google_books_id TEXT,
    created_at TEXT NOT NULL,updated_at TEXT NOT NULL,deleted_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS user_books (
    id TEXT PRIMARY KEY,user_id TEXT NOT NULL,book_id TEXT NOT NULL,edition_id TEXT,status TEXT NOT NULL,
    owned INTEGER NOT NULL DEFAULT 0,rating INTEGER,review TEXT,progress_type TEXT,progress_value REAL,
    progress_total REAL,started_at TEXT,finished_at TEXT,favorite INTEGER NOT NULL DEFAULT 0,notes TEXT,
    created_at TEXT NOT NULL,updated_at TEXT NOT NULL,deleted_at TEXT
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
  `CREATE INDEX IF NOT EXISTS idx_user_books_user ON user_books(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_user_books_book ON user_books(book_id)`,
  `CREATE INDEX IF NOT EXISTS idx_library_books_added ON library_books(added_at)`
];

const v3Columns: Array<[string, string]> = [
  ["favorite", "INTEGER NOT NULL DEFAULT 0"],
  ["owned", "INTEGER NOT NULL DEFAULT 1"],
  ["progress_value", "REAL"],
  ["progress_total", "REAL"],
  ["started_at", "TEXT"],
  ["finished_at", "TEXT"],
  ["updated_at", "TEXT"]
];

async function columnNames(db: SqliteAdapter): Promise<Set<string>> {
  const rows = await db.query<{ name: string }>("PRAGMA table_info(library_books)");
  return new Set(rows.map(row => String(row.name)));
}

export async function runMigrations(db: SqliteAdapter): Promise<void> {
  await db.transaction(async () => {
    await db.execute(baseStatements[0]);

    for (const sql of baseStatements.slice(1)) {
      await db.execute(sql);
    }

    const columns = await columnNames(db);
    for (const [name, definition] of v3Columns) {
      if (!columns.has(name)) {
        await db.execute(`ALTER TABLE library_books ADD COLUMN ${name} ${definition}`);
      }
    }

    await db.execute(
      "UPDATE library_books SET updated_at = COALESCE(updated_at, added_at)"
    );

    const rows = await db.query<{ version: number }>(
      "SELECT version FROM schema_migrations WHERE version = ?",
      [VERSION]
    );
    if (!rows.length) {
      await db.execute(
        "INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)",
        [VERSION, new Date().toISOString()]
      );
    }
  });
}
