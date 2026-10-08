import initSqlJs, { type Database } from "sql.js";
import type { SqliteAdapter, SqliteResult, SqliteRow } from "../src/adapter";

/** In-memory SQLite adapter (sql.js) used to test the repository against real SQL. */
export async function createTestAdapter(
  options: { ignoreForeignKeysPragma?: boolean } = {}
): Promise<SqliteAdapter & { raw: Database }> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run("PRAGMA foreign_keys = ON");
  let depth = 0;
  return {
    raw: db,
    async execute(sql: string, params: unknown[] = []): Promise<SqliteResult> {
      // The Capacitor plugin runs each statement inside a transaction, where
      // PRAGMA foreign_keys is a silent no-op. This option reproduces that.
      if (options.ignoreForeignKeysPragma && /^\s*PRAGMA\s+foreign_keys/i.test(sql)) return { rowsAffected: 0 };
      db.run(sql, params as never[]);
      return { rowsAffected: db.getRowsModified() };
    },
    async query<T extends SqliteRow = SqliteRow>(sql: string, params: unknown[] = []): Promise<T[]> {
      const statement = db.prepare(sql);
      try {
        statement.bind(params as never[]);
        const rows: T[] = [];
        while (statement.step()) rows.push(statement.getAsObject() as T);
        return rows;
      } finally { statement.free(); }
    },
    async executeMany(statements: Array<{ sql: string; params: unknown[] }>): Promise<void> {
      for (const { sql, params } of statements) db.run(sql, params as never[]);
    },
    async transaction<T>(work: () => Promise<T>): Promise<T> {
      if (depth > 0) { depth++; try { return await work(); } finally { depth--; } }
      db.run("BEGIN");
      depth = 1;
      try { const result = await work(); db.run("COMMIT"); return result; }
      catch (error) { db.run("ROLLBACK"); throw error; }
      finally { depth = 0; }
    }
  };
}
