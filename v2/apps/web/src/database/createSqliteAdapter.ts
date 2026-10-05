import { Capacitor } from "@capacitor/core";
import type { SqliteAdapter } from "@tsundoku/database";
import { CapacitorSqliteAdapter } from "./CapacitorSqliteAdapter";
import { WebSqliteAdapter } from "./WebSqliteAdapter";

export async function createSqliteAdapter(): Promise<SqliteAdapter> {
  if (Capacitor.isNativePlatform()) {
    return CapacitorSqliteAdapter.create();
  }
  return WebSqliteAdapter.create();
}
