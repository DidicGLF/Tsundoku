import type { Book, UserBook } from "@tsundoku/types";
import type { SqliteAdapter } from "./adapter";
export interface BookRepository { list():Promise<Book[]>; upsert(book:Book):Promise<void>; }
export interface UserBookRepository { list(userId:string):Promise<UserBook[]>; upsert(item:UserBook):Promise<void>; }
export class SqliteBookRepository implements BookRepository {
 constructor(private readonly db:SqliteAdapter){}
 async list():Promise<Book[]> {
  const rows=await this.db.query<any>("SELECT * FROM books WHERE deleted_at IS NULL ORDER BY updated_at DESC");
  return rows.map((r:any)=>({id:r.id,title:r.title,originalTitle:r.original_title,description:r.description,language:r.language,
   coverUrl:r.cover_url,firstPublishedYear:r.first_published_year,openLibraryWorkId:r.openlibrary_work_id,
   googleBooksId:r.google_books_id,createdAt:r.created_at,updatedAt:r.updated_at,deletedAt:r.deleted_at}));
 }
 async upsert(b:Book):Promise<void>{
  await this.db.execute(`INSERT INTO books(id,title,original_title,description,language,cover_url,first_published_year,openlibrary_work_id,google_books_id,created_at,updated_at,deleted_at)
 VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,description=excluded.description,cover_url=excluded.cover_url,updated_at=excluded.updated_at,deleted_at=excluded.deleted_at`,
 [b.id,b.title,b.originalTitle??null,b.description??null,b.language??null,b.coverUrl??null,b.firstPublishedYear??null,b.openLibraryWorkId??null,b.googleBooksId??null,b.createdAt,b.updatedAt,b.deletedAt??null]);
 }
}
export class SqliteUserBookRepository implements UserBookRepository {
 constructor(private readonly db:SqliteAdapter){}
 async list(userId:string):Promise<UserBook[]> {
  const rows=await this.db.query<any>("SELECT * FROM user_books WHERE user_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC",[userId]);
  return rows.map((r:any)=>({id:r.id,userId:r.user_id,bookId:r.book_id,editionId:r.edition_id,status:r.status,owned:Boolean(r.owned),
   rating:r.rating,review:r.review,progressType:r.progress_type,progressValue:r.progress_value,progressTotal:r.progress_total,
   favorite:Boolean(r.favorite),notes:r.notes,createdAt:r.created_at,updatedAt:r.updated_at,deletedAt:r.deleted_at}));
 }
 async upsert(x:UserBook):Promise<void>{
  await this.db.execute(`INSERT INTO user_books(id,user_id,book_id,edition_id,status,owned,rating,review,progress_type,progress_value,progress_total,favorite,notes,created_at,updated_at,deleted_at)
 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,owned=excluded.owned,rating=excluded.rating,review=excluded.review,progress_value=excluded.progress_value,favorite=excluded.favorite,notes=excluded.notes,updated_at=excluded.updated_at,deleted_at=excluded.deleted_at`,
 [x.id,x.userId,x.bookId,x.editionId??null,x.status,x.owned?1:0,x.rating??null,x.review??null,x.progressType??null,x.progressValue??null,x.progressTotal??null,x.favorite?1:0,x.notes??null,x.createdAt,x.updatedAt,x.deletedAt??null]);
 }
}
