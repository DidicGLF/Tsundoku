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

  async execute(sql: string, params: unknown[] = []): Promise<SqliteResult> {
    const result = params.length
      ? await this.db.run(sql, params)
      : await this.db.execute(sql);

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
  return work();
}
}
