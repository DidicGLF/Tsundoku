import type { SqliteAdapter } from "./adapter";

export const DATABASE_VERSION = 1;

export const migrations = [{
  version: 1,
  name: "initial_schema",
  sql: `
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS books (
      id TEXT PRIMARY KEY NOT NULL,
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
    );

    CREATE TABLE IF NOT EXISTS editions (
      id TEXT PRIMARY KEY NOT NULL,
      book_id TEXT NOT NULL,
      title TEXT NOT NULL,
      language TEXT,
      publisher TEXT,
      publication_date TEXT,
      isbn10 TEXT,
      isbn13 TEXT,
      page_count INTEGER,
      cover_url TEXT,
      openlibrary_edition_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      FOREIGN KEY (book_id) REFERENCES books(id)
    );

    CREATE TABLE IF NOT EXISTS authors (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      sort_name TEXT,
      biography TEXT,
      photo_url TEXT,
      openlibrary_author_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS book_authors (
      book_id TEXT NOT NULL,
      author_id TEXT NOT NULL,
      role TEXT,
      PRIMARY KEY (book_id, author_id),
      FOREIGN KEY (book_id) REFERENCES books(id),
      FOREIGN KEY (author_id) REFERENCES authors(id)
    );

    CREATE TABLE IF NOT EXISTS series (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS book_series (
      book_id TEXT NOT NULL,
      series_id TEXT NOT NULL,
      position REAL,
      PRIMARY KEY (book_id, series_id),
      FOREIGN KEY (book_id) REFERENCES books(id),
      FOREIGN KEY (series_id) REFERENCES series(id)
    );

    CREATE TABLE IF NOT EXISTS user_books (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT,
      book_id TEXT NOT NULL,
      edition_id TEXT,
      status TEXT NOT NULL DEFAULT 'TO_READ',
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
      deleted_at TEXT,
      FOREIGN KEY (book_id) REFERENCES books(id),
      FOREIGN KEY (edition_id) REFERENCES editions(id)
    );

    CREATE TABLE IF NOT EXISTS reading_sessions (
      id TEXT PRIMARY KEY NOT NULL,
      user_book_id TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      start_progress REAL,
      end_progress REAL,
      duration_seconds INTEGER,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_book_id) REFERENCES user_books(id)
    );

    CREATE TABLE IF NOT EXISTS lists (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT,
      name TEXT NOT NULL,
      description TEXT,
      icon TEXT,
      color TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS list_books (
      list_id TEXT NOT NULL,
      user_book_id TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      PRIMARY KEY (list_id, user_book_id),
      FOREIGN KEY (list_id) REFERENCES lists(id),
      FOREIGN KEY (user_book_id) REFERENCES user_books(id)
    );

    CREATE TABLE IF NOT EXISTS settings (
      user_id TEXT PRIMARY KEY NOT NULL,
      theme TEXT NOT NULL DEFAULT 'system',
      language TEXT NOT NULL DEFAULT 'fr',
      default_view TEXT NOT NULL DEFAULT 'grid',
      default_sort TEXT NOT NULL DEFAULT 'title',
      notifications_enabled INTEGER NOT NULL DEFAULT 1,
      auto_sync_enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT,
      name TEXT NOT NULL,
      platform TEXT NOT NULL,
      app_version TEXT NOT NULL,
      last_seen_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_books_updated_at ON books(updated_at);
    CREATE INDEX IF NOT EXISTS idx_user_books_updated_at ON user_books(updated_at);
    CREATE INDEX IF NOT EXISTS idx_user_books_status ON user_books(status);
    CREATE INDEX IF NOT EXISTS idx_reading_sessions_user_book ON reading_sessions(user_book_id);
    CREATE INDEX IF NOT EXISTS idx_authors_name ON authors(name);
  `
}] as const;

export async function ensureMigrationsTable(db: SqliteAdapter): Promise<void> {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);
}

export async function runMigrations(db: SqliteAdapter): Promise<void> {
  await ensureMigrationsTable(db);
  const applied = await db.query<{ version: number }>(
    "SELECT version FROM schema_migrations ORDER BY version"
  );
  const appliedVersions = new Set(applied.map(row => Number(row.version)));

  for (const migration of migrations) {
    if (appliedVersions.has(migration.version)) continue;
    await db.transaction(async () => {
      await db.execute(migration.sql);
      await db.execute(
        "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
        [migration.version, migration.name, new Date().toISOString()]
      );
    });
  }
}
