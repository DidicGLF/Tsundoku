import { BnfClient, GoogleBooksClient, OpenLibraryClient, canonicalIsbn, cleanIsbn, isSameEdition, mergeSearchResults, normalizeText as normalize, type BookSearchField, type BookSearchLanguage, type BookSearchResult } from "@tsundoku/book-sources";
import { getCredentialStore } from "./credentials";

export type SearchProvider = "all" | "bnf" | "open-library" | "google-books";
export type { BookSearchField, BookSearchLanguage };
export { mergeSearchResults };

const bnf = new BnfClient();
const openLibrary = new OpenLibraryClient();
const googleBooks = new GoogleBooksClient(getCredentialStore());

const languageAliases: Record<Exclude<BookSearchLanguage, "all">, string[]> = {
  fr: ["fr", "fre", "fra", "francais", "french"],
  en: ["en", "eng", "anglais", "english"],
  de: ["de", "ger", "deu", "allemand", "german"],
  es: ["es", "spa", "espagnol", "spanish"],
  it: ["it", "ita", "italien", "italian"]
};

function normalizedLanguage(value?: string): string {
  return normalize(value ?? "");
}

export type BookLanguageGroup = "preferred" | "unknown" | "other";

export function getBookLanguageGroup(book: BookSearchResult, language: BookSearchLanguage): BookLanguageGroup {
  if (language === "all") return "preferred";
  const value = normalizedLanguage(book.language);
  if (!value) return "unknown";
  if (languageAliases[language].some(alias => value === alias || value.startsWith(`${alias} `) || value.startsWith(`${alias}-`))) return "preferred";
  return "other";
}

export function getBookLanguageLabel(book: BookSearchResult): string {
  const value = normalizedLanguage(book.language);
  if (!value) return "?";
  for (const [code, aliases] of Object.entries(languageAliases)) {
    if (aliases.some(alias => value === alias || value.startsWith(`${alias} `) || value.startsWith(`${alias}-`))) return code.toUpperCase();
  }
  return book.language?.trim().slice(0, 5).toUpperCase() || "?";
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await work(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

/*
 * Cache de jaquettes persistant : localStorage fonctionne aussi dans la WebView
 * Capacitor. On ne refait donc pas les mêmes recherches à chaque lancement.
 */
const COVER_CACHE_KEY = "tsundoku.cover-cache.v1";
let coverCacheMemory: Record<string, string | null> | null = null;

function coverKey(book: BookSearchResult): string {
  return canonicalIsbn(book) ?? `${normalize(book.title)}::${normalize(book.authors[0] ?? "")}`;
}

function loadCoverCache(): Record<string, string | null> {
  if (coverCacheMemory) return coverCacheMemory;
  try {
    const parsed = JSON.parse(localStorage.getItem(COVER_CACHE_KEY) ?? "{}");
    coverCacheMemory = parsed && typeof parsed === "object" ? parsed as Record<string, string | null> : {};
  } catch {
    coverCacheMemory = {};
  }
  return coverCacheMemory;
}

function cachedCover(book: BookSearchResult): string | undefined {
  const value = loadCoverCache()[coverKey(book)];
  return typeof value === "string" && value ? value : undefined;
}

function rememberCover(book: BookSearchResult, url?: string): void {
  const cache = loadCoverCache();
  const key = coverKey(book);
  // On mémorise les succès. Les échecs ne sont conservés que pour la session afin
  // de permettre une nouvelle tentative lors d'un prochain lancement.
  if (!url) return;
  if (cache[key] === url) return;
  cache[key] = url;
  try { localStorage.setItem(COVER_CACHE_KEY, JSON.stringify(cache)); } catch { /* cache facultatif */ }
}

interface OpenLibraryBooksData {
  [key: string]: { cover?: { small?: string; medium?: string; large?: string } } | undefined;
}

async function fetchOpenLibraryCovers(books: BookSearchResult[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const byIsbn = new Map<string, BookSearchResult[]>();
  for (const book of books) {
    if (book.coverUrl || cachedCover(book)) continue;
    const isbn = canonicalIsbn(book) ?? cleanIsbn(book.isbn10);
    if (!isbn) continue;
    const list = byIsbn.get(isbn) ?? [];
    list.push(book);
    byIsbn.set(isbn, list);
  }

  const isbns = [...byIsbn.keys()];
  const chunks: string[][] = [];
  for (let start = 0; start < isbns.length; start += 50) chunks.push(isbns.slice(start, start + 50));

  // Les lots Open Library sont indépendants : on en traite jusqu'à 3 en parallèle.
  // Cela accélère fortement les grosses bibliographies sans lancer une rafale illimitée.
  const partials = await mapWithConcurrency(chunks, 3, async chunk => {
    const covers = new Map<string, string>();
    try {
      const bibkeys = chunk.map(isbn => `ISBN:${isbn}`).join(",");
      const params = new URLSearchParams({ bibkeys, format: "json", jscmd: "data" });
      const response = await fetch(`https://openlibrary.org/api/books?${params}`);
      if (!response.ok) return covers;
      const data = await response.json() as OpenLibraryBooksData;
      for (const isbn of chunk) {
        const cover = data[`ISBN:${isbn}`]?.cover;
        const url = cover?.large ?? cover?.medium ?? cover?.small;
        if (!url) continue;
        for (const book of byIsbn.get(isbn) ?? []) covers.set(coverKey(book), url.replace(/^http:/, "https:"));
      }
    } catch {
      // Une panne de Covers API ne doit pas bloquer l'application.
    }
    return covers;
  });

  for (const covers of partials) for (const [key, url] of covers) result.set(key, url);
  return result;
}

async function findGoogleCover(book: BookSearchResult): Promise<string | undefined> {
  try {
    const isbn = canonicalIsbn(book) ?? cleanIsbn(book.isbn10);
    if (isbn) {
      const candidates = await googleBooks.search(isbn, "all", 0, "isbn");
      const exact = candidates.find(candidate => canonicalIsbn(candidate) === canonicalIsbn(book) && candidate.coverUrl);
      if (exact?.coverUrl) return exact.coverUrl;
      const first = candidates.find(candidate => candidate.coverUrl);
      if (first?.coverUrl) return first.coverUrl;
    }

    const query = [book.title, book.authors[0]].filter(Boolean).join(" ");
    if (!query) return undefined;
    const candidates = await googleBooks.search(query, "all", 0, "all");
    return candidates.find(candidate => candidate.coverUrl && isSameEdition(book, candidate))?.coverUrl;
  } catch {
    return undefined;
  }
}

/**
 * Enrichissement non bloquant destiné à être lancé après l'affichage.
 * 1. cache local persistant ; 2. une requête Open Library par lot d'ISBN ;
 * 3. Google Books seulement pour les jaquettes encore absentes.
 */
export async function enrichSearchResults(books: BookSearchResult[], language: BookSearchLanguage): Promise<BookSearchResult[]> {
  let enriched = books.map(book => ({ ...book, coverUrl: book.coverUrl ?? cachedCover(book) }));

  // Deux travaux utiles partent immédiatement en parallèle :
  // - Open Library traite efficacement tous les ISBN par lots ;
  // - Google traite déjà les livres sans ISBN, qu'Open Library ne pourrait pas aider.
  const withoutIsbn = enriched.filter(book => !book.coverUrl && !canonicalIsbn(book) && !cleanIsbn(book.isbn10));
  const [openLibraryCovers, googleWithoutIsbn] = await Promise.all([
    fetchOpenLibraryCovers(enriched),
    mapWithConcurrency(withoutIsbn, 5, async book => ({ book, coverUrl: await findGoogleCover(book) }))
  ]);

  const firstPass = new Map<string, string>();
  for (const { book, coverUrl } of googleWithoutIsbn) {
    if (!coverUrl) continue;
    firstPass.set(coverKey(book), coverUrl.replace(/^http:/, "https:"));
  }

  enriched = enriched.map(book => {
    const coverUrl = book.coverUrl ?? openLibraryCovers.get(coverKey(book)) ?? firstPass.get(coverKey(book));
    if (coverUrl) rememberCover(book, coverUrl);
    return coverUrl === book.coverUrl ? book : { ...book, coverUrl };
  });

  // Google ne reçoit ensuite que les ISBN pour lesquels Open Library n'a rien trouvé.
  // Concurrence volontairement bornée à 5 pour préserver les quotas et Android.
  const missing = enriched.filter(book => !book.coverUrl);
  if (missing.length) {
    const googleCovers = await mapWithConcurrency(missing, 5, async book => ({ book, coverUrl: await findGoogleCover(book) }));
    const byKey = new Map<string, string>();
    for (const { book, coverUrl } of googleCovers) {
      if (!coverUrl) continue;
      const httpsUrl = coverUrl.replace(/^http:/, "https:");
      rememberCover(book, httpsUrl);
      byKey.set(coverKey(book), httpsUrl);
    }
    enriched = enriched.map(book => book.coverUrl ? book : { ...book, coverUrl: byKey.get(coverKey(book)) });
  }

  return rank(mergeSearchResults(enriched), language);
}

function rank(books: BookSearchResult[], language: BookSearchLanguage): BookSearchResult[] {
  const weight: Record<BookLanguageGroup, number> = { preferred: 2, unknown: 1, other: 0 };
  return books.map((book, index) => ({ book, index, score: weight[getBookLanguageGroup(book, language)] }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(item => item.book);
}

const MAX_AUTHOR_RESULTS_PER_SOURCE = 1000;

function sourcePageSize(source: BnfClient | OpenLibraryClient | GoogleBooksClient): number {
  return source.id === "bnf" ? 100 : 40;
}

function sourceResultKey(book: BookSearchResult): string {
  const isbn = canonicalIsbn(book);
  if (isbn) return `isbn:${isbn}`;
  return `${book.source}:${book.sourceId || `${normalize(book.title)}::${normalize(book.authors[0] ?? "")}`}`;
}

async function fetchCompleteAuthorSource(
  source: BnfClient | OpenLibraryClient | GoogleBooksClient,
  query: string,
  language: BookSearchLanguage
): Promise<BookSearchResult[]> {
  const collected: BookSearchResult[] = [];
  const seen = new Set<string>();
  const pageSize = sourcePageSize(source);
  const pageConcurrency = source.id === "google-books" ? 3 : 4;

  // Les pages d'une bibliographie sont indépendantes. On les récupère par vagues
  // parallèles plutôt qu'une par une. Une vague peut légèrement dépasser la fin
  // réelle du catalogue, mais réduit fortement la latence sur les auteurs prolifiques.
  for (let waveStart = 0; waveStart < MAX_AUTHOR_RESULTS_PER_SOURCE; waveStart += pageSize * pageConcurrency) {
    const offsets = Array.from({ length: pageConcurrency }, (_, index) => waveStart + index * pageSize)
      .filter(offset => offset < MAX_AUTHOR_RESULTS_PER_SOURCE);
    const settled = await Promise.allSettled(offsets.map(offset => source.search(query, language, offset, "author")));

    let shouldStop = false;
    let addedThisWave = 0;
    for (let index = 0; index < settled.length; index++) {
      const result = settled[index];
      if (result.status === "rejected") continue;
      const page = result.value;
      if (!page.length) {
        shouldStop = true;
        continue;
      }
      for (const book of page) {
        const key = sourceResultKey(book);
        if (seen.has(key)) continue;
        seen.add(key);
        collected.push(book);
        addedThisWave++;
      }
      if (page.length < pageSize) shouldStop = true;
    }

    if (shouldStop || addedThisWave === 0) break;
  }
  return collected;
}

const completeAuthorCache = new Map<string, Promise<BookSearchResult[]>>();

/**
 * Mode fast-first : en mode « Toutes les sources », la bibliographie complète
 * provient d'une seule source principale au lieu d'attendre BnF + OL + Google.
 * - français : BnF (catalogue français, pages de 100 notices)
 * - autres langues : Open Library
 * L'autre source n'est utilisée qu'en secours si la principale ne répond pas.
 * Les jaquettes sont enrichies ensuite, sans bloquer l'affichage.
 */
export async function searchCompleteAuthorBibliography(
  q: string,
  p: SearchProvider,
  language: BookSearchLanguage = "all",
  forceRefresh = false
): Promise<BookSearchResult[]> {
  q = q.trim();
  if (!q) return [];

  const cacheKey = `${p}::${language}::${normalize(q)}`;
  if (forceRefresh) completeAuthorCache.delete(cacheKey);
  const cached = completeAuthorCache.get(cacheKey);
  if (cached) return cached;

  const promise = (async () => {
    if (p !== "all") {
      const source = p === "bnf" ? bnf : p === "open-library" ? openLibrary : googleBooks;
      return rank(mergeSearchResults(await fetchCompleteAuthorSource(source, q, language)), language);
    }

    const primary = language === "fr" || language === "all" ? bnf : openLibrary;
    const fallback = primary.id === "bnf" ? openLibrary : bnf;
    try {
      const books = await fetchCompleteAuthorSource(primary, q, language);
      if (books.length) return rank(mergeSearchResults(books), language);
    } catch {
      // on essaie la source de secours juste après
    }
    const fallbackBooks = await fetchCompleteAuthorSource(fallback, q, language);
    return rank(mergeSearchResults(fallbackBooks), language);
  })();

  completeAuthorCache.set(cacheKey, promise);
  try {
    return await promise;
  } catch (error) {
    completeAuthorCache.delete(cacheKey);
    throw error;
  }
}

export async function searchBooks(q: string, p: SearchProvider, language: BookSearchLanguage = "all", offset = 0, field: BookSearchField = "all"): Promise<BookSearchResult[]> {
  q = q.trim();
  if (!q) return [];
  if (p === "bnf") return rank(mergeSearchResults(await bnf.search(q, language, offset, field)), language);
  if (p === "open-library") return rank(mergeSearchResults(await openLibrary.search(q, language, offset, field)), language);
  if (p === "google-books") return rank(mergeSearchResults(await googleBooks.search(q, language, offset, field)), language);

  const searches = [openLibrary.search(q, language, offset, field), googleBooks.search(q, language, offset, field)];
  if (language === "fr" || language === "all") searches.unshift(bnf.search(q, language, offset, field));
  const settled = await Promise.allSettled(searches);
  const books = settled.flatMap(result => result.status === "fulfilled" ? result.value : []);
  if (!books.length && settled.every(result => result.status === "rejected")) throw new Error("Aucune source de livres n'est disponible.");
  return rank(mergeSearchResults(books), language);
}
