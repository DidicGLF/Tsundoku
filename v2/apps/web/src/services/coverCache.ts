import { canonicalIsbn, normalizeText, type BookSearchResult } from "@tsundoku/book-sources";

/*
 * Deux caches persistants (localStorage fonctionne aussi dans la WebView Capacitor) :
 * - les jaquettes trouvées, pour ne pas les rechercher à chaque lancement ;
 * - les échecs, pour ne pas refaire pendant des jours les requêtes qui n'aboutissent pas.
 */
const COVER_KEY = "tsundoku.cover-cache.v1";
const MISS_KEY = "tsundoku.cover-misses.v1";
const MISS_TTL_MS = 7 * 24 * 3600 * 1000;

export function coverKey(book: BookSearchResult): string {
  return canonicalIsbn(book) ?? `${normalizeText(book.title)}::${normalizeText(book.authors[0] ?? "")}`;
}

let covers: Record<string, string> | null = null;
let misses: Record<string, number> | null = null;

function load<T extends object>(key: string): T {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? "{}");
    return parsed && typeof parsed === "object" ? parsed as T : {} as T;
  } catch {
    return {} as T;
  }
}

function save(key: string, value: object): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* cache facultatif */ }
}

export function cachedCover(book: BookSearchResult): string | undefined {
  covers ??= load<Record<string, string>>(COVER_KEY);
  const value = covers[coverKey(book)];
  return typeof value === "string" && value ? value : undefined;
}

export function rememberCover(book: BookSearchResult, url: string): void {
  covers ??= load<Record<string, string>>(COVER_KEY);
  const key = coverKey(book);
  if (covers[key] === url) return;
  covers[key] = url;
  save(COVER_KEY, covers);
}

/** `scope` sépare les échecs d'une source de ceux des autres (vide = recherche par titre). */
const missKey = (book: BookSearchResult, scope: string) => scope ? `${scope}|${coverKey(book)}` : coverKey(book);

export function recentlyMissed(book: BookSearchResult, now = Date.now(), scope = ""): boolean {
  misses ??= load<Record<string, number>>(MISS_KEY);
  const at = misses[missKey(book, scope)];
  return typeof at === "number" && now - at < MISS_TTL_MS;
}

export function rememberMiss(book: BookSearchResult, now = Date.now(), scope = ""): void {
  misses ??= load<Record<string, number>>(MISS_KEY);
  misses[missKey(book, scope)] = now;
  save(MISS_KEY, misses);
}

export function withCachedCovers(books: BookSearchResult[]): BookSearchResult[] {
  return books.map(book => book.coverUrl ? book : { ...book, coverUrl: cachedCover(book) });
}
