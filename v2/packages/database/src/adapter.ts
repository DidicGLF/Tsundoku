export interface SqliteResult { rowsAffected:number; lastInsertId?:string|number; }
export interface SqliteRow { [column:string]:unknown; }
export interface SqlStatement { sql:string; params:unknown[]; }
export interface SqliteAdapter {
 execute(sql:string,params?:unknown[]):Promise<SqliteResult>;
 query<T extends SqliteRow=SqliteRow>(sql:string,params?:unknown[]):Promise<T[]>;
 /** Runs many write statements in one native call (one round trip on Android). */
 executeMany(statements:SqlStatement[]):Promise<void>;
 transaction<T>(work:()=>Promise<T>):Promise<T>;
}
