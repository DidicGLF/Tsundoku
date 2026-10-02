export interface SqliteResult {
  rowsAffected: number;
  lastInsertId?: string | number;
}

export interface SqliteRow {
  [column: string]: unknown;
}

export interface SqliteAdapter {
  execute(sql: string, params?: unknown[]): Promise<SqliteResult>;
  query<T extends SqliteRow = SqliteRow>(sql: string, params?: unknown[]): Promise<T[]>;
  transaction<T>(work: () => Promise<T>): Promise<T>;
}
