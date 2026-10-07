import { CapacitorSQLite, SQLiteConnection, type SQLiteDBConnection } from "@capacitor-community/sqlite";
import type { SqliteAdapter, SqliteResult, SqliteRow } from "@tsundoku/database";

export class CapacitorSqliteAdapter implements SqliteAdapter {

  private constructor(private readonly db: SQLiteDBConnection) {}

  static async create(): Promise<CapacitorSqliteAdapter> {
    const sqlite = new SQLiteConnection(CapacitorSQLite);
    const consistency = await sqlite.checkConnectionsConsistency();
    const hasConnection = (await sqlite.isConnection("tsundoku", false)).result;

    if (!consistency.result && hasConnection) {
      await sqlite.closeConnection("tsundoku", false);
    }

    const db = await sqlite.createConnection("tsundoku", false, "no-encryption", 1, false);
    await db.open();
    await db.execute("PRAGMA foreign_keys = ON;");
    return new CapacitorSqliteAdapter(db);
  }

  private transactionDepth = 0;

  async execute(sql: string, params: unknown[] = []): Promise<SqliteResult> {
    // Inside our own transaction the plugin must not open another one.
    const wrap = this.transactionDepth === 0;
    const result = params.length
      ? await this.db.run(sql, params, wrap)
      : await this.db.execute(sql, wrap);

    const changes = result.changes;
    return {
      rowsAffected: changes?.changes ?? 0,
      lastInsertId: changes?.lastId
    };
  }

  async query<T extends SqliteRow = SqliteRow>(sql: string, params: unknown[] = []): Promise<T[]> {
    const result = await this.db.query(sql, params);
    return (result.values ?? []) as T[];
  }

  async transaction<T>(work: () => Promise<T>): Promise<T> {
    if (this.transactionDepth > 0) {
      this.transactionDepth++;
      try { return await work(); } finally { this.transactionDepth--; }
    }

    await this.db.beginTransaction();
    this.transactionDepth = 1;
    try {
      const result = await work();
      await this.db.commitTransaction();
      return result;
    } catch (error) {
      try { await this.db.rollbackTransaction(); } catch { /* already rolled back */ }
      throw error;
    } finally {
      this.transactionDepth = 0;
    }
  }
}
