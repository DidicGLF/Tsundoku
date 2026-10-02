import type { Book, UserBook, ReadingStatus } from "@tsundoku/types";
import type { SqliteAdapter } from "./adapter";

export interface BookRepository {
  list(): Promise<Book[]>;
  getById(id: string): Promise<Book | null>;
  save(book: Book): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface UserBookRepository {
  list(): Promise<UserBook[]>;
  getById(id: string): Promise<UserBook | null>;
  save(userBook: UserBook): Promise<void>;
  updateStatus(id: string, status: ReadingStatus): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface Repositories {
  books: BookRepository;
  userBooks: UserBookRepository;
}

export class SqliteBookRepository implements BookRepository {
  constructor(private readonly db: SqliteAdapter) {}

  async list(): Promise<Book[]> {
    const rows = await this.db.query<BookRow>(
      `SELECT id,title,original_title,description,language,cover_url,
       first_published_year,openlibrary_work_id,google_books_id,
       created_at,updated_at,deleted_at
       FROM books WHERE deleted_at IS NULL ORDER BY title COLLATE NOCASE`
    );
    return rows.map(mapBookRow);
  }

  async getById(id: string): Promise<Book | null> {
    const rows = await this.db.query<BookRow>(
      `SELECT id,title,original_title,description,language,cover_url,
       first_published_year,openlibrary_work_id,google_books_id,
       created_at,updated_at,deleted_at
       FROM books WHERE id = ? AND deleted_at IS NULL LIMIT 1`, [id]
    );
    return rows[0] ? mapBookRow(rows[0]) : null;
  }

  async save(book: Book): Promise<void> {
    await this.db.execute(
      `INSERT INTO books
       (id,title,original_title,description,language,cover_url,first_published_year,
        openlibrary_work_id,google_books_id,created_at,updated_at,deleted_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
        title=excluded.title, original_title=excluded.original_title,
        description=excluded.description, language=excluded.language,
        cover_url=excluded.cover_url, first_published_year=excluded.first_published_year,
        openlibrary_work_id=excluded.openlibrary_work_id,
        google_books_id=excluded.google_books_id, updated_at=excluded.updated_at,
        deleted_at=excluded.deleted_at`,
      [book.id,book.title,book.originalTitle??null,book.description??null,
       book.language??null,book.coverUrl??null,book.firstPublishedYear??null,
       book.openLibraryWorkId??null,book.googleBooksId??null,book.createdAt,
       book.updatedAt,book.deletedAt??null]
    );
  }

  async delete(id: string): Promise<void> {
    const now = new Date().toISOString();
    await this.db.execute(
      "UPDATE books SET deleted_at = ?, updated_at = ? WHERE id = ?", [now, now, id]
    );
  }
}

export class SqliteUserBookRepository implements UserBookRepository {
  constructor(private readonly db: SqliteAdapter) {}

  async list(): Promise<UserBook[]> {
    const rows = await this.db.query<UserBookRow>(
      `SELECT id,user_id,book_id,edition_id,status,owned,rating,review,
       progress_type,progress_value,progress_total,started_at,finished_at,
       favorite,notes,created_at,updated_at,deleted_at
       FROM user_books WHERE deleted_at IS NULL ORDER BY updated_at DESC`
    );
    return rows.map(mapUserBookRow);
  }

  async getById(id: string): Promise<UserBook | null> {
    const rows = await this.db.query<UserBookRow>(
      `SELECT id,user_id,book_id,edition_id,status,owned,rating,review,
       progress_type,progress_value,progress_total,started_at,finished_at,
       favorite,notes,created_at,updated_at,deleted_at
       FROM user_books WHERE id = ? AND deleted_at IS NULL LIMIT 1`, [id]
    );
    return rows[0] ? mapUserBookRow(rows[0]) : null;
  }

  async save(userBook: UserBook): Promise<void> {
    await this.db.execute(
      `INSERT INTO user_books
       (id,user_id,book_id,edition_id,status,owned,rating,review,progress_type,
        progress_value,progress_total,started_at,finished_at,favorite,notes,
        created_at,updated_at,deleted_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
        user_id=excluded.user_id, book_id=excluded.book_id,
        edition_id=excluded.edition_id, status=excluded.status,
        owned=excluded.owned, rating=excluded.rating, review=excluded.review,
        progress_type=excluded.progress_type, progress_value=excluded.progress_value,
        progress_total=excluded.progress_total, started_at=excluded.started_at,
        finished_at=excluded.finished_at, favorite=excluded.favorite,
        notes=excluded.notes, updated_at=excluded.updated_at,
        deleted_at=excluded.deleted_at`,
      [userBook.id,userBook.userId??null,userBook.bookId,userBook.editionId??null,
       userBook.status,userBook.owned?1:0,userBook.rating??null,userBook.review??null,
       userBook.progressType??null,userBook.progressValue??null,
       userBook.progressTotal??null,userBook.startedAt??null,userBook.finishedAt??null,
       userBook.favorite?1:0,userBook.notes??null,userBook.createdAt,
       userBook.updatedAt,userBook.deletedAt??null]
    );
  }

  async updateStatus(id: string, status: ReadingStatus): Promise<void> {
    await this.db.execute(
      "UPDATE user_books SET status = ?, updated_at = ? WHERE id = ?",
      [status, new Date().toISOString(), id]
    );
  }

  async delete(id: string): Promise<void> {
    const now = new Date().toISOString();
    await this.db.execute(
      "UPDATE user_books SET deleted_at = ?, updated_at = ? WHERE id = ?", [now, now, id]
    );
  }
}

interface BookRow {
  id:string; title:string; original_title:string|null; description:string|null;
  language:string|null; cover_url:string|null; first_published_year:number|null;
  openlibrary_work_id:string|null; google_books_id:string|null;
  created_at:string; updated_at:string; deleted_at:string|null;
}

function mapBookRow(row: BookRow): Book {
  return {
    id: row.id, title: row.title,
    originalTitle: row.original_title ?? undefined,
    description: row.description ?? undefined,
    language: row.language ?? undefined,
    coverUrl: row.cover_url ?? undefined,
    firstPublishedYear: row.first_published_year ?? undefined,
    openLibraryWorkId: row.openlibrary_work_id ?? undefined,
    googleBooksId: row.google_books_id ?? undefined,
    createdAt: row.created_at, updatedAt: row.updated_at,
    deletedAt: row.deleted_at ?? undefined
  };
}

interface UserBookRow {
  id:string; user_id:string|null; book_id:string; edition_id:string|null;
  status:ReadingStatus; owned:number|boolean; rating:number|null; review:string|null;
  progress_type:UserBook["progressType"]|null; progress_value:number|null;
  progress_total:number|null; started_at:string|null; finished_at:string|null;
  favorite:number|boolean; notes:string|null; created_at:string;
  updated_at:string; deleted_at:string|null;
}

function mapUserBookRow(row: UserBookRow): UserBook {
  return {
    id:row.id, userId:row.user_id??undefined, bookId:row.book_id,
    editionId:row.edition_id??undefined, status:row.status,
    owned:Boolean(row.owned), rating:row.rating??undefined,
    review:row.review??undefined, progressType:row.progress_type??undefined,
    progressValue:row.progress_value??undefined, progressTotal:row.progress_total??undefined,
    startedAt:row.started_at??undefined, finishedAt:row.finished_at??undefined,
    favorite:Boolean(row.favorite), notes:row.notes??undefined,
    createdAt:row.created_at, updatedAt:row.updated_at,
    deletedAt:row.deleted_at??undefined
  };
}
