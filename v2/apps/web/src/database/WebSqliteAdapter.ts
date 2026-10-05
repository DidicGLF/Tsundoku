import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import type { SqliteAdapter, SqliteResult, SqliteRow } from "@tsundoku/database";

const IDB_NAME = "tsundoku-v2";
const IDB_VERSION = 2;
const STORE_NAME = "files";
const DB_KEY = "library.sqlite";

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
  });
}

async function openStorage(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_NAME, IDB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.close();
        reject(new Error(`IndexedDB ne contient pas le magasin "${STORE_NAME}".`));
        return;
      }
      resolve(db);
    };
    request.onerror = () => reject(request.error ?? new Error("Impossible d'ouvrir IndexedDB."));
    request.onblocked = () => reject(new Error("IndexedDB est bloquée par un autre onglet Tsundoku."));
  });
}

async function readDatabaseBytes(storage: IDBDatabase): Promise<Uint8Array | null> {
  const transaction = storage.transaction(STORE_NAME, "readonly");
  const value = await requestToPromise(transaction.objectStore(STORE_NAME).get(DB_KEY));
  await transactionDone(transaction);
  if (!value) return null;
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new Error("Le fichier SQLite enregistré a un format invalide.");
}

async function writeDatabaseBytes(storage: IDBDatabase, bytes: Uint8Array): Promise<void> {
  const transaction = storage.transaction(STORE_NAME, "readwrite");
  transaction.objectStore(STORE_NAME).put(bytes.slice().buffer, DB_KEY);
  await transactionDone(transaction);
}

export class WebSqliteAdapter implements SqliteAdapter {
  private transactionDepth = 0;

  private constructor(
    private readonly db: Database,
    private readonly storage: IDBDatabase
  ) {}

  static async create(): Promise<WebSqliteAdapter> {
    if (typeof indexedDB === "undefined") {
      throw new Error("IndexedDB n'est pas disponible dans ce navigateur.");
    }

    const SQL: SqlJsStatic = await initSqlJs({ locateFile: () => wasmUrl });
    const storage = await openStorage();
    const bytes = await readDatabaseBytes(storage);
    const db = bytes ? new SQL.Database(bytes) : new SQL.Database();
    const adapter = new WebSqliteAdapter(db, storage);

    if (!bytes) await adapter.persist();
    return adapter;
  }

  private async persist(): Promise<void> {
    await writeDatabaseBytes(this.storage, this.db.export());
  }

  async execute(sql: string, params: unknown[] = []): Promise<SqliteResult> {
    this.db.run(sql, params as any[]);
    const result = { rowsAffected: this.db.getRowsModified() };
    if (this.transactionDepth === 0) await this.persist();
    return result;
  }

  async query<T extends SqliteRow = SqliteRow>(
    sql: string,
    params: unknown[] = []
  ): Promise<T[]> {
    const statement = this.db.prepare(sql);
    try {
      statement.bind(params as any[]);
      const rows: T[] = [];
      while (statement.step()) rows.push(statement.getAsObject() as T);
      return rows;
    } finally {
      statement.free();
    }
  }

  async transaction<T>(work: () => Promise<T>): Promise<T> {
    if (this.transactionDepth > 0) {
      this.transactionDepth++;
      try {
        return await work();
      } finally {
        this.transactionDepth--;
      }
    }

    this.db.run("BEGIN");
    this.transactionDepth = 1;
    try {
      const result = await work();
      this.db.run("COMMIT");
      this.transactionDepth = 0;
      await this.persist();
      return result;
    } catch (error) {
      try { this.db.run("ROLLBACK"); } catch {}
      this.transactionDepth = 0;
      throw error;
    }
  }
}
