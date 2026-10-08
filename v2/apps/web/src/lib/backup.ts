import type { EditionUpdate, FollowedAuthor, ReadingStatus, SqliteLibraryRepository, UserBookState } from "@tsundoku/database";
import type { BookSourceId } from "@tsundoku/book-sources";
import { createWorkIndex, editionOf, findLocalWork, type WorkIndex } from "./library-view";
import { toNewBook } from "./new-book";
import type { LibraryBook } from "../services/library";

/** Version du format de fichier. Une sauvegarde plus récente que l'app est refusée, une plus ancienne est lue. */
export const BACKUP_FORMAT = 1;

export interface BackupBook {
  title: string;
  authors: string[];
  source: BookSourceId;
  sourceId: string;
  isbn10?: string;
  isbn13?: string;
  publisher?: string;
  collection?: string;
  publishedYear?: number;
  pageCount?: number;
  language?: string;
  description?: string;
  coverUrl?: string;
  seriesName?: string;
  seriesVolume?: number;
  owned: boolean;
  favorite: boolean;
  status: ReadingStatus;
  rating?: number;
  progressValue?: number;
  progressTotal?: number;
  startedAt?: string;
  finishedAt?: string;
  addedAt?: string;
}

export interface BackupFile {
  app: "tsundoku";
  format: number;
  exportedAt: string;
  books: BackupBook[];
  followedAuthors: Array<{ authorKey: string; name: string; lastRefreshedAt?: string }>;
}

const STATUSES: ReadingStatus[] = ["TO_READ", "READING", "READ", "ON_HOLD", "ABANDONED"];
const SOURCES: BookSourceId[] = ["open-library", "google-books", "bnf", "manual"];

export function buildBackup(library: LibraryBook[], followed: FollowedAuthor[], now = new Date()): BackupFile {
  return {
    app: "tsundoku",
    format: BACKUP_FORMAT,
    exportedAt: now.toISOString(),
    books: library.map(book => ({
      title: book.title, authors: book.authors, source: book.source, sourceId: book.sourceId,
      isbn10: book.isbn10, isbn13: book.isbn13, publisher: book.publisher, collection: book.collection,
      publishedYear: book.publishedYear, pageCount: book.pageCount, language: book.language, description: book.description,
      coverUrl: book.coverUrl, seriesName: book.seriesName, seriesVolume: book.seriesVolume,
      owned: book.owned, favorite: book.favorite, status: book.status, rating: book.rating,
      progressValue: book.progressValue, progressTotal: book.progressTotal,
      startedAt: book.startedAt, finishedAt: book.finishedAt, addedAt: book.addedAt
    })),
    followedAuthors: followed.map(author => ({ authorKey: author.authorKey, name: author.name, lastRefreshedAt: author.lastRefreshedAt }))
  };
}

export function backupFileName(now = new Date()): string {
  return `tsundoku-sauvegarde-${now.toISOString().slice(0, 10)}.json`;
}

const text = (value: unknown): string | undefined => (typeof value === "string" && value.trim() ? value : undefined);
const number = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) ? value : undefined);

/** Lit et valide un fichier de sauvegarde. Les champs inconnus sont ignorés, les valeurs douteuses écartées. */
export function parseBackup(raw: string): BackupFile {
  let data: unknown;
  try { data = JSON.parse(raw); } catch { throw new Error("Ce fichier n'est pas une sauvegarde Tsundoku (JSON illisible)."); }
  const file = data as Partial<BackupFile> | null;
  if (!file || typeof file !== "object" || file.app !== "tsundoku" || !Array.isArray(file.books)) {
    throw new Error("Ce fichier n'est pas une sauvegarde Tsundoku.");
  }
  if (typeof file.format !== "number" || file.format > BACKUP_FORMAT) {
    throw new Error("Cette sauvegarde vient d'une version plus récente de Tsundoku : mets l'application à jour.");
  }

  const books: BackupBook[] = [];
  for (const item of file.books as unknown as Array<Record<string, unknown>>) {
    const title = text(item?.title);
    if (!title) continue;
    const rating = number(item.rating);
    books.push({
      title,
      authors: Array.isArray(item.authors) ? item.authors.filter((name): name is string => typeof name === "string" && Boolean(name.trim())) : [],
      source: SOURCES.includes(item.source as BookSourceId) ? item.source as BookSourceId : "manual",
      sourceId: text(item.sourceId) ?? `import:${title}`,
      isbn10: text(item.isbn10), isbn13: text(item.isbn13), publisher: text(item.publisher), collection: text(item.collection),
      publishedYear: number(item.publishedYear), pageCount: number(item.pageCount), language: text(item.language),
      description: text(item.description),
      // Une jaquette locale (photo) est reprise ; une adresse doit être en https.
      coverUrl: (() => { const url = text(item.coverUrl); return url && (url.startsWith("https://") || url.startsWith("data:image/")) ? url : undefined; })(),
      seriesName: text(item.seriesName), seriesVolume: number(item.seriesVolume),
      owned: item.owned !== false,
      favorite: item.favorite === true,
      status: STATUSES.includes(item.status as ReadingStatus) ? item.status as ReadingStatus : "TO_READ",
      rating: rating && Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : undefined,
      progressValue: number(item.progressValue), progressTotal: number(item.progressTotal),
      startedAt: text(item.startedAt), finishedAt: text(item.finishedAt), addedAt: text(item.addedAt)
    });
  }

  const followedAuthors = Array.isArray(file.followedAuthors)
    ? file.followedAuthors.flatMap(author => text(author?.authorKey) && text(author?.name)
        ? [{ authorKey: author.authorKey, name: author.name, lastRefreshedAt: text(author.lastRefreshedAt) }] : [])
    : [];
  return { app: "tsundoku", format: file.format, exportedAt: text(file.exportedAt) ?? "", books, followedAuthors };
}

export interface ImportPlan {
  add: BackupBook[];
  merge: Array<{ id: string; state: UserBookState; edition?: EditionUpdate }>;
  /** Livres déjà identiques dans la bibliothèque. */
  unchanged: number;
}

const rank = (status: ReadingStatus) => (status === "READ" ? 3 : status === "READING" ? 2 : 1);

/**
 * Fusionne une sauvegarde dans la bibliothèque, sans rien écraser : un livre déjà présent (même ISBN,
 * ou même œuvre) garde ses données, et reçoit seulement ce qui lui manque (possédé, favori, statut le
 * plus avancé, note, dates). Les autres sont ajoutés.
 */
export function planImport(backup: BackupFile, library: LibraryBook[]): ImportPlan {
  const index: WorkIndex = createWorkIndex(library);
  const plan: ImportPlan = { add: [], merge: [], unchanged: 0 };
  for (const book of backup.books) {
    const local = findLocalWork(book as never, index);
    if (!local) { plan.add.push(book); continue; }

    const state: UserBookState = {};
    if (book.owned && !local.owned) state.owned = true;
    if (book.favorite && !local.favorite) state.favorite = true;
    if (rank(book.status) > rank(local.status)) state.status = book.status;
    if (local.rating == null && book.rating != null) state.rating = book.rating;
    if (!local.startedAt && book.startedAt) state.startedAt = book.startedAt;
    if (!local.finishedAt && book.finishedAt) state.finishedAt = book.finishedAt;
    if (local.progressValue == null && book.progressValue != null) {
      state.progressValue = book.progressValue;
      state.progressTotal = book.progressTotal ?? null;
    }
    const edition = book.owned && !local.owned ? editionOf(book) : undefined;
    if (Object.keys(state).length || edition) plan.merge.push({ id: local.id, state, edition });
    else plan.unchanged++;
  }
  return plan;
}

export interface ImportReport { added: number; merged: number; unchanged: number; authors: number }

/** Applique le plan d'import en une seule transaction : tout ou rien. */
export async function applyImportTo(repo: SqliteLibraryRepository, plan: ImportPlan, backup: BackupFile): Promise<ImportReport> {
  let authors = 0;
  await repo.batch(async () => {
    for (const item of plan.merge) {
      await repo.applyState(item.id, item.state);
      if (item.edition) await repo.setEdition(item.id, item.edition);
    }
    for (const book of plan.add) {
      await repo.importBook(
        { ...toNewBook(book as never, { owned: book.owned }), collection: book.collection },
        {
          owned: book.owned, favorite: book.favorite, status: book.status, rating: book.rating ?? null,
          progressValue: book.progressValue ?? null, progressTotal: book.progressTotal ?? null,
          startedAt: book.startedAt ?? null, finishedAt: book.finishedAt ?? null
        }
      );
    }
    for (const author of backup.followedAuthors) {
      if (!(await repo.getFollowedAuthor(author.authorKey))) {
        await repo.upsertFollowedAuthor(author.authorKey, author.name, author.lastRefreshedAt ?? new Date().toISOString());
        authors++;
      }
    }
  });
  return { added: plan.add.length, merged: plan.merge.length, unchanged: plan.unchanged, authors };
}
