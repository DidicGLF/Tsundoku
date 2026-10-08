import type { SqliteAdapter } from "./adapter";

/**
 * Ordered, append-only list of migrations. The applied count is stored in
 * `PRAGMA user_version`; never edit an existing entry once released, add a new one.
 */
const migrations: string[][] = [
  // 1 — initial schema
  [
    `CREATE TABLE books (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      original_title TEXT,
      description TEXT,
      language TEXT,
      cover_url TEXT,
      first_published_year INTEGER,
      source TEXT NOT NULL,
      source_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(source, source_id)
    )`,
    `CREATE TABLE editions (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL REFERENCES books(id),
      title TEXT,
      publisher TEXT,
      published_year INTEGER,
      isbn10 TEXT,
      isbn13 TEXT,
      page_count INTEGER,
      language TEXT,
      cover_url TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE authors (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE book_authors (
      book_id TEXT NOT NULL REFERENCES books(id),
      author_id TEXT NOT NULL REFERENCES authors(id),
      position INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(book_id, author_id)
    )`,
    `CREATE TABLE series (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE book_series (
      book_id TEXT PRIMARY KEY REFERENCES books(id),
      series_id TEXT NOT NULL REFERENCES series(id),
      volume_number REAL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE user_books (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      book_id TEXT NOT NULL REFERENCES books(id),
      edition_id TEXT REFERENCES editions(id),
      status TEXT NOT NULL DEFAULT 'TO_READ',
      owned INTEGER NOT NULL DEFAULT 1,
      favorite INTEGER NOT NULL DEFAULT 0,
      newly_discovered INTEGER NOT NULL DEFAULT 0,
      progress_value REAL,
      progress_total REAL,
      started_at TEXT,
      finished_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      UNIQUE(user_id, book_id)
    )`,
    `CREATE TABLE reading_sessions (
      id TEXT PRIMARY KEY,
      user_book_id TEXT NOT NULL REFERENCES user_books(id),
      started_at TEXT NOT NULL,
      duration_minutes INTEGER NOT NULL,
      start_progress REAL,
      end_progress REAL,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    )`,
    `CREATE TABLE followed_authors (
      author_key TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      last_refreshed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE INDEX idx_user_books_user ON user_books(user_id, deleted_at)`,
    `CREATE INDEX idx_editions_book ON editions(book_id)`,
    `CREATE INDEX idx_editions_isbn13 ON editions(isbn13)`,
    `CREATE INDEX idx_editions_isbn10 ON editions(isbn10)`,
    `CREATE INDEX idx_book_authors_book ON book_authors(book_id, position)`,
    `CREATE INDEX idx_book_series_series ON book_series(series_id, volume_number)`,
    `CREATE INDEX idx_reading_sessions_book ON reading_sessions(user_book_id, started_at)`
  ],
  // 2 — star rating (1–5, NULL = not rated); the reading journal is gone
  [
    `ALTER TABLE user_books ADD COLUMN rating INTEGER`,
    `DROP INDEX IF EXISTS idx_reading_sessions_book`,
    `DROP TABLE IF EXISTS reading_sessions`
  ]
];

export const SCHEMA_VERSION = migrations.length;

/** Tables created by pre-release builds, before `user_version` was used. */
const PRE_RELEASE_MARKERS = ["library_books", "schema_migrations"];

async function currentVersion(db: SqliteAdapter): Promise<number> {
  const rows = await db.query<{ user_version: number }>("PRAGMA user_version");
  return Number(rows[0]?.user_version ?? 0);
}

async function dropEverything(db: SqliteAdapter): Promise<void> {
  const tables = await db.query<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
  );
  // PRAGMA foreign_keys is a no-op inside a transaction (the native plugin wraps every
  // statement in one), so defer the checks instead: they are verified at commit, when
  // every table is gone and nothing can be violated.
  await db.transaction(async () => {
    await db.execute("PRAGMA defer_foreign_keys = ON");
    for (const { name } of tables) await db.execute(`DROP TABLE IF EXISTS "${name}"`);
  });
}

/** `targetVersion` lets tests stop early to exercise an upgrade path. */
export async function runMigrations(db: SqliteAdapter, targetVersion = migrations.length): Promise<void> {
  let version = await currentVersion(db);

  if (version === 0) {
    // Databases from pre-release builds hold throw-away data in an unversioned schema.
    const existing = await db.query<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${PRE_RELEASE_MARKERS.map(() => "?").join(",")})`,
      PRE_RELEASE_MARKERS
    );
    if (existing.length) await dropEverything(db);
  }

  while (version < targetVersion) {
    const statements = migrations[version];
    await db.transaction(async () => {
      for (const sql of statements) await db.execute(sql);
    });
    version++;
    // PRAGMA does not accept bound parameters.
    await db.execute(`PRAGMA user_version = ${version}`);
  }
}
