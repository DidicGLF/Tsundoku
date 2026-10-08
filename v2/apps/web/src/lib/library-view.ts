import {
  canonicalAuthorDisplay, canonicalAuthorIdentity, canonicalAuthorSort, canonicalIsbn, cleanIsbn, isSameAuthorName, isSameWork, normalizeText, shareAuthor, workTitle,
  type BookSearchResult
} from "@tsundoku/book-sources";
import type { ReadingStatus } from "@tsundoku/database";
import type { LibraryBook } from "../services/library";

export const statusLabels: Record<ReadingStatus, string> = {
  TO_READ: "À lire",
  READING: "En cours",
  READ: "Lu",
  ON_HOLD: "En pause",
  ABANDONED: "Abandonné"
};

export type LibraryFilter = "ALL" | ReadingStatus | "FAVORITES" | "OWNED" | "MISSING";
export type LibrarySort = "RECENT" | "TITLE" | "AUTHOR" | "PROGRESS";
export type AuthorBookFilter = "ALL" | "MISSING" | "OWNED" | "READ" | "TO_READ";
export type AuthorBookSort = "MISSING" | "TITLE" | "DATE";

export function displayAuthors(authors: string[]): string {
  const values = authors.map(canonicalAuthorDisplay).filter(name => name && name !== "Auteur inconnu");
  return values.join(", ") || "Auteur inconnu";
}

export function countStatus(library: LibraryBook[], status: ReadingStatus): number {
  return library.filter(book => book.status === status).length;
}

/** Reading progress in percent, or -1 when unknown (so unknown sorts last). */
export function progressPercent(book: LibraryBook): number {
  if (!book.progressTotal || book.progressValue == null) return -1;
  return Math.min(100, (book.progressValue / book.progressTotal) * 100);
}

export function primaryAuthor(book: LibraryBook): string {
  return canonicalAuthorDisplay(book.authors[0] ?? "");
}

export function authorInitial(author: string): string {
  const first = canonicalAuthorSort(author).trim()[0]?.toUpperCase() ?? "#";
  return /^[A-Z]$/.test(first) ? first : "#";
}

const byRecent = (a: LibraryBook, b: LibraryBook) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
const byTitle = (a: { title: string }, b: { title: string }) => a.title.localeCompare(b.title, "fr");

export function filterLibrary(library: LibraryBook[], filter: LibraryFilter, query: string): LibraryBook[] {
  const needle = query.trim().toLocaleLowerCase("fr");
  return library.filter(book => {
    const matchesFilter =
      filter === "ALL" ||
      (filter === "FAVORITES" ? book.favorite :
        filter === "OWNED" ? book.owned :
        filter === "MISSING" ? !book.owned :
        book.status === filter);
    if (!matchesFilter) return false;
    if (!needle) return true;
    return [book.title, ...book.authors, book.isbn10 ?? "", book.isbn13 ?? "", book.publisher ?? ""]
      .join(" ").toLocaleLowerCase("fr").includes(needle);
  });
}

export function sortLibrary(books: LibraryBook[], sort: LibrarySort): LibraryBook[] {
  return [...books].sort((a, b) => {
    if (sort === "TITLE") return byTitle(a, b);
    if (sort === "AUTHOR") return canonicalAuthorSort(primaryAuthor(a)).localeCompare(canonicalAuthorSort(primaryAuthor(b)), "fr");
    if (sort === "PROGRESS") return progressPercent(b) - progressPercent(a);
    return byRecent(a, b);
  });
}

export interface AuthorGroup {
  author: string;
  initial: string;
  anchor: string;
  books: LibraryBook[];
  ownedCount: number;
}

/** Groups books by primary author (alphabetical), ordering each group by `sort`. */
export function groupByAuthor(books: LibraryBook[], sort: LibrarySort): AuthorGroup[] {
  const groups = new Map<string, { author: string; books: LibraryBook[] }>();
  for (const book of books) {
    const author = primaryAuthor(book);
    const key = canonicalAuthorIdentity(author);
    const current = groups.get(key);
    if (current) current.books.push(book);
    else groups.set(key, { author, books: [book] });
  }

  return [...groups.values()]
    .sort((a, b) => canonicalAuthorSort(a.author).localeCompare(canonicalAuthorSort(b.author), "fr"))
    .map(group => ({
      author: group.author,
      initial: authorInitial(group.author),
      anchor: `author-${normalizeText(group.author).replace(/\s+/g, "-") || "unknown"}`,
      books: [...group.books].sort((a, b) =>
        sort === "PROGRESS" ? progressPercent(b) - progressPercent(a) :
        sort === "RECENT" ? byRecent(a, b) : byTitle(a, b)),
      ownedCount: group.books.filter(book => book.owned).length
    }));
}

export function libraryFilterCounts(library: LibraryBook[]): Array<[LibraryFilter, string, number]> {
  return [
    ["ALL", "Tous", library.length],
    ["MISSING", "Manquants", library.filter(book => !book.owned).length],
    ["OWNED", "Possédés", library.filter(book => book.owned).length],
    ["TO_READ", "À lire", countStatus(library, "TO_READ")],
    ["READING", "En cours", countStatus(library, "READING")],
    ["READ", "Lus", countStatus(library, "READ")],
    ["ON_HOLD", "En pause", countStatus(library, "ON_HOLD")],
    ["ABANDONED", "Abandonnés", countStatus(library, "ABANDONED")],
    ["FAVORITES", "★ Favoris", library.filter(book => book.favorite).length]
  ];
}

/**
 * Les notices BnF d'anthologies ou de recueils dirigés n'ont aucun auteur : trouvées en
 * cherchant un auteur, elles lui sont rattachées plutôt que rangées sous « Auteur inconnu ».
 */
export function attributeOrphans<T extends { authors: string[] }>(books: T[], authorName: string): T[] {
  return books.map(book => book.authors.some(name => name.trim()) ? book : { ...book, authors: [authorName] });
}

export type LibraryState = "none" | "tracked" | "owned";

/**
 * Où en est un résultat de recherche dans la bibliothèque : absent, suivi (présent mais pas
 * possédé, par exemple venu d'une bibliographie d'auteur) ou possédé.
 */
export function libraryStateOf(result: BookSearchResult, index: WorkIndex): LibraryState {
  const local = findLocalWork(result, index);
  return !local ? "none" : local.owned ? "owned" : "tracked";
}

/* ---- Author bibliography ---- */

export function booksOfAuthor(library: LibraryBook[], authorKey: string | null): LibraryBook[] {
  if (!authorKey) return [];
  return library.filter(book => canonicalAuthorIdentity(book.authors[0] ?? "") === authorKey);
}

export function authorStats(books: LibraryBook[]) {
  const owned = books.filter(book => book.owned).length;
  const read = books.filter(book => book.status === "READ").length;
  return {
    total: books.length,
    owned,
    read,
    missing: books.length - owned,
    unread: books.length - read,
    newlyDiscovered: books.filter(book => book.newlyDiscovered).length
  };
}

export function filterAuthorBooks(books: LibraryBook[], filter: AuthorBookFilter, sort: AuthorBookSort): LibraryBook[] {
  const filtered = books.filter(book => {
    if (filter === "MISSING") return !book.owned;
    if (filter === "OWNED") return book.owned;
    if (filter === "READ") return book.status === "READ";
    if (filter === "TO_READ") return book.status !== "READ";
    return true;
  });
  return filtered.sort((a, b) => {
    if (sort === "TITLE") return byTitle(a, b);
    if (sort === "DATE") return (b.publishedYear ?? -1) - (a.publishedYear ?? -1) || byTitle(a, b);
    return Number(a.owned) - Number(b.owned) || byTitle(a, b);
  });
}

export interface SeriesGroup {
  /** Undefined : livres hors série (ou liste à plat quand aucune série n'est connue). */
  name?: string;
  books: LibraryBook[];
}

/**
 * Regroupe par série (tomes dans l'ordre), les livres hors série à la fin dans l'ordre reçu.
 * Sans aucune série connue, renvoie un seul groupe sans titre : la liste reste à plat.
 */
export function groupBySeries(books: LibraryBook[]): SeriesGroup[] {
  const bySeries = new Map<string, SeriesGroup>();
  const standalone: LibraryBook[] = [];
  for (const book of books) {
    const name = book.seriesName?.trim();
    if (!name) { standalone.push(book); continue; }
    const key = normalizeText(name);
    const group = bySeries.get(key) ?? { name, books: [] };
    group.books.push(book);
    bySeries.set(key, group);
  }
  if (!bySeries.size) return [{ books: standalone }];
  const groups = [...bySeries.values()].map(group => ({
    ...group,
    books: [...group.books].sort((a, b) => (a.seriesVolume ?? Infinity) - (b.seriesVolume ?? Infinity) || byTitle(a, b))
  })).sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", "fr"));
  if (standalone.length) groups.push({ books: standalone });
  return groups;
}

/** Initiales d'un nom (« Frank Herbert » → « FH »). */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  const letters = words.length === 1 ? [...words[0]].slice(0, 2) : [[...words[0]][0], [...words[words.length - 1]][0]];
  return letters.join("").toLocaleUpperCase("fr");
}

export interface WorkIndex {
  byTitle: Map<string, LibraryBook[]>;
  byIsbn: Map<string, LibraryBook>;
  bySource: Map<string, LibraryBook>;
}

const isbnsOf = (book: { isbn10?: string; isbn13?: string }) =>
  [canonicalIsbn(book), cleanIsbn(book.isbn10), cleanIsbn(book.isbn13)].filter((value): value is string => Boolean(value));

/** Index des livres de la bibliothèque, pour retrouver l'œuvre d'un résultat sans comparer un par un. */
export function createWorkIndex(library: LibraryBook[]): WorkIndex {
  const index: WorkIndex = { byTitle: new Map(), byIsbn: new Map(), bySource: new Map() };
  for (const book of library) {
    index.bySource.set(`${book.source}:${book.sourceId}`, book);
    const key = normalizeText(workTitle(book.title));
    index.byTitle.set(key, [...(index.byTitle.get(key) ?? []), book]);
    for (const isbn of isbnsOf(book)) index.byIsbn.set(isbn, book);
  }
  return index;
}

/**
 * L'œuvre de la bibliothèque correspondant à un résultat : même ISBN, ou même titre d'œuvre
 * et un auteur en commun. C'est ce qui évite qu'une autre édition crée un doublon.
 */
export function findLocalWork(book: BookSearchResult, index: WorkIndex): LibraryBook | undefined {
  const sameRecord = index.bySource.get(`${book.source}:${book.sourceId}`);
  if (sameRecord) return sameRecord;
  for (const isbn of isbnsOf(book)) {
    const found = index.byIsbn.get(isbn);
    if (found) return found;
  }
  return (index.byTitle.get(normalizeText(workTitle(book.title))) ?? []).find(local => shareAuthor(book.authors, local.authors));
}

/**
 * Complète un nom d'auteur incomplet avec celui déjà présent dans la bibliothèque
 * (« Eddings » → « David Eddings »), pour ne pas créer un second groupe d'auteur.
 * Si plusieurs auteurs conviennent (David et Leigh Eddings), on prend le nettement plus fréquent, sinon on ne touche à rien.
 */
export function completeAuthorNames(authors: string[], library: Array<Pick<LibraryBook, "authors">>): string[] {
  const counts = new Map<string, { name: string; count: number }>();
  for (const book of library) {
    for (const name of book.authors) {
      const key = canonicalAuthorIdentity(name);
      if (!key) continue;
      const entry = counts.get(key) ?? { name, count: 0 };
      entry.count++;
      counts.set(key, entry);
    }
  }
  return authors.map(name => {
    const identity = canonicalAuthorIdentity(name);
    if (!identity) return name;
    // Déjà connu tel quel : rien à compléter.
    if (counts.has(identity)) return counts.get(identity)!.name;
    const fuller = [...counts.entries()]
      .filter(([key, entry]) => key.split(" ").length > identity.split(" ").length && isSameAuthorName(name, entry.name))
      .map(([, entry]) => entry)
      .sort((x, y) => y.count - x.count);
    if (!fuller.length) return name;
    return fuller.length === 1 || fuller[0].count >= 2 * fuller[1].count ? fuller[0].name : name;
  });
}

export interface DuplicateMerge {
  keepId: string;
  removeIds: string[];
  /** Ce que la fiche conservée récupère des doublons (possédé, favori, statut, note). */
  changes: { owned?: boolean; favorite?: boolean; status?: LibraryBook["status"]; rating?: number };
}

const statusRank = (status: LibraryBook["status"]) => (status === "READ" ? 3 : status === "READING" ? 2 : 1);

/**
 * Doublons d'une même œuvre (autre édition ajoutée séparément) : on garde la fiche la plus
 * ancienne et on lui reporte ce que les autres savent (possédé, favori, avancement, note).
 */
export function planDuplicateMerges(library: LibraryBook[]): DuplicateMerge[] {
  const ordered = [...library].sort((a, b) => new Date(a.addedAt).getTime() - new Date(b.addedAt).getTime());
  const index: WorkIndex = { byTitle: new Map(), byIsbn: new Map(), bySource: new Map() };
  const groups = new Map<string, LibraryBook[]>();
  for (const book of ordered) {
    const keeper = findLocalWork(book as unknown as BookSearchResult, index);
    if (keeper) { groups.get(keeper.id)?.push(book); continue; }
    groups.set(book.id, [book]);
    const key = normalizeText(workTitle(book.title));
    index.byTitle.set(key, [...(index.byTitle.get(key) ?? []), book]);
    index.bySource.set(`${book.source}:${book.sourceId}`, book);
    for (const isbn of isbnsOf(book)) index.byIsbn.set(isbn, book);
  }

  const merges: DuplicateMerge[] = [];
  for (const [keepId, group] of groups) {
    if (group.length < 2) continue;
    const keeper = group[0];
    const changes: DuplicateMerge["changes"] = {};
    if (!keeper.owned && group.some(book => book.owned)) changes.owned = true;
    if (!keeper.favorite && group.some(book => book.favorite)) changes.favorite = true;
    const best = group.reduce((top, book) => (statusRank(book.status) > statusRank(top.status) ? book : top), keeper);
    if (statusRank(best.status) > statusRank(keeper.status)) changes.status = best.status;
    const rating = group.find(book => book.rating != null)?.rating;
    if (keeper.rating == null && rating != null) changes.rating = rating;
    merges.push({ keepId, removeIds: group.slice(1).map(book => book.id), changes });
  }
  return merges;
}

/** Works of `remote` that have no counterpart yet in `current`. */
export function findNewWorks(remote: BookSearchResult[], current: LibraryBook[]): BookSearchResult[] {
  return remote.filter(book => !current.some(local => isSameWork(book, local)));
}

/* ---- Formatting ---- */

const dateTimeFormat = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" });

export function formatDateTime(value: string): string {
  return dateTimeFormat.format(new Date(value));
}

export function formatRefreshDate(value?: string): string {
  return value ? formatDateTime(value) : "Jamais";
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return count > 1 ? many : one;
}

/* ---- Page du livre : progression, note, dates ---- */

/** Avancement saisi en pourcentage : les pages sont déduites du nombre de pages connu, sinon on garde 100 comme total. */
export function progressUpdateFor(book: { pageCount?: number; progressTotal?: number }, percent: number): { progressValue: number; progressTotal: number } {
  const pct = Math.max(0, Math.min(100, Math.round(percent)));
  const total = book.progressTotal || book.pageCount || 100;
  return { progressValue: Math.round((total * pct) / 100), progressTotal: total };
}

/** Pourcentage lu (0 si rien n'est renseigné). */
export function readPercent(book: LibraryBook): number {
  const pct = progressPercent(book);
  return pct < 0 ? 0 : Math.round(pct);
}

/** Page atteinte, uniquement quand le nombre de pages de l'édition est connu. */
export function pageReached(book: { pageCount?: number }, percent: number): number | undefined {
  return book.pageCount ? Math.round((book.pageCount * percent) / 100) : undefined;
}

export const ratingLabels = ["Pas encore noté", "Bof", "Passable", "Bien", "Très bien", "Coup de cœur"] as const;

const dayFormat = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long" });

function dayCount(from: string, to: string): number {
  return Math.max(1, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000));
}

/** Ligne de dates sous le statut : dans la pile depuis…, commencé le…, terminé le…. */
export function bookDatesLine(book: Pick<LibraryBook, "status" | "addedAt" | "startedAt" | "finishedAt">, now = new Date()): string {
  const day = (value: string) => dayFormat.format(new Date(value));
  if (book.status === "READ" && book.startedAt && book.finishedAt) {
    const days = dayCount(book.startedAt, book.finishedAt);
    return `Commencé le ${day(book.startedAt)} · terminé le ${day(book.finishedAt)} · ${days} ${plural(days, "jour")}`;
  }
  if (book.status === "READ" && book.finishedAt) return `Terminé le ${day(book.finishedAt)}`;
  if (book.status === "READING" && book.startedAt) {
    const days = dayCount(book.startedAt, now.toISOString());
    return `Commencé le ${day(book.startedAt)} · ${days} ${plural(days, "jour")} de lecture`;
  }
  return `Dans ma pile depuis le ${day(book.addedAt)}`;
}
