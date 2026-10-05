import type { SqliteAdapter } from "./adapter";
const statements=[
`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)`,
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
`CREATE INDEX IF NOT EXISTS idx_user_books_user ON user_books(user_id)`,
`CREATE INDEX IF NOT EXISTS idx_user_books_book ON user_books(book_id)`
];
export async function runMigrations(db:SqliteAdapter):Promise<void>{
 await db.transaction(async()=>{for(const sql of statements)await db.execute(sql);
 const rows=await db.query<{version:number}>("SELECT version FROM schema_migrations WHERE version = ?",[1]);
 if(!rows.length)await db.execute("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)",[1,new Date().toISOString()]);
 });
}
