import {
  BnfClient, GoogleBooksClient, OpenLibraryClient, canonicalIsbn, isUnusableNotice, mergeSearchResults, normalizeText as normalize,
  type BookSearchField, type BookSearchLanguage, type BookSearchResult
} from "@tsundoku/book-sources";
import { withCachedCovers } from "./coverCache";
import { getCredentialStore } from "./credentials";
import { rankByLanguage } from "./language";

export type SearchProvider = "all" | "bnf" | "open-library" | "google-books";
export type { BookSearchField, BookSearchLanguage };
export { mergeSearchResults };
export { enrichSearchResults } from "./covers";
export { getBookLanguageGroup, getBookLanguageLabel, type BookLanguageGroup } from "./language";

/** Appelée à chaque fois qu'une source répond, avec tout ce qui est connu jusque-là. */
export type SearchProgress = (books: BookSearchResult[]) => void;
/** Prévient l'utilisateur qu'une source est injoignable (résultats possiblement incomplets). */
export type SearchNotice = (message: string) => void;

const sourceLabel = (source: Source) => source.id === "bnf" ? "BnF" : source.id === "google-books" ? "Google Books" : "Open Library";

type Source = BnfClient | OpenLibraryClient | GoogleBooksClient;

const bnf = new BnfClient();
const openLibrary = new OpenLibraryClient();
const googleBooks = new GoogleBooksClient(getCredentialStore());

async function hasGoogleKey(): Promise<boolean> {
  try { return Boolean(await getCredentialStore().getGoogleBooksApiKey()); } catch { return false; }
}

const prepare = (books: BookSearchResult[], language: BookSearchLanguage) =>
  rankByLanguage(withCachedCovers(mergeSearchResults(books.filter(book => !isUnusableNotice(book)))), language);

/**
 * Interroge plusieurs sources en parallèle et publie les résultats dès qu'une répond :
 * on n'attend plus la plus lente (BnF : 0,3 à 6 s) pour afficher Open Library.
 * Échoue seulement si toutes les sources échouent.
 */
async function gather(
  requests: Array<{ source: Source; promise: Promise<BookSearchResult[]> }>,
  language: BookSearchLanguage, onProgress?: SearchProgress, onNotice?: SearchNotice
): Promise<BookSearchResult[]> {
  let merged: BookSearchResult[] = [];
  const failed: Source[] = [];
  const errors: unknown[] = [];
  await Promise.all(requests.map(({ source, promise }) => promise.then(
    found => {
      merged = mergeSearchResults([...merged, ...found]);
      onProgress?.(prepare(merged, language));
    },
    error => { errors.push(error); failed.push(source); }
  )));
  if (errors.length === requests.length) {
    throw requests.length === 1 ? errors[0] : new Error("Aucune source de livres n'est disponible.");
  }
  if (failed.length) onNotice?.(`${failed.map(sourceLabel).join(", ")} injoignable : résultats incomplets.`);
  return prepare(merged, language);
}

export async function searchBooks(
  q: string, p: SearchProvider, language: BookSearchLanguage = "all", offset = 0, field: BookSearchField = "all",
  onProgress?: SearchProgress,
  onNotice?: SearchNotice
): Promise<BookSearchResult[]> {
  q = q.trim();
  if (!q) return [];
  const search = (source: Source) => ({ source, promise: source.search(q, language, offset, field) });

  if (p === "bnf") return gather([search(bnf)], language, onProgress, onNotice);
  if (p === "open-library") return gather([search(openLibrary)], language, onProgress, onNotice);
  if (p === "google-books") return gather([search(googleBooks)], language, onProgress, onNotice);

  const requests = [search(openLibrary)];
  if (language === "fr" || language === "all") requests.unshift(search(bnf));
  // Sans clé, le quota anonyme de Google est épuisé : inutile de perdre une requête.
  if (await hasGoogleKey()) requests.push(search(googleBooks));
  return gather(requests, language, onProgress, onNotice);
}

/* ---- Bibliographie complète d'un auteur ---- */

const MAX_AUTHOR_RESULTS_PER_SOURCE = 1000;

function sourcePageSize(source: Source): number {
  return source.id === "bnf" ? 100 : 40;
}

function sourceResultKey(book: BookSearchResult): string {
  const isbn = canonicalIsbn(book);
  if (isbn) return `isbn:${isbn}`;
  return `${book.source}:${book.sourceId || `${normalize(book.title)}::${normalize(book.authors[0] ?? "")}`}`;
}


async function fetchCompleteAuthorSource(
  source: Source,
  query: string,
  language: BookSearchLanguage,
  onWave?: (collected: BookSearchResult[]) => void
): Promise<BookSearchResult[]> {
  const collected: BookSearchResult[] = [];
  const seen = new Set<string>();
  const pageSize = sourcePageSize(source);
  const pageConcurrency = source.id === "google-books" ? 3 : 4;

  // Les pages d'une bibliographie sont indépendantes : on les récupère par vagues
  // parallèles. Après chaque vague, on publie ce qu'on a déjà, pour que l'écran se
  // remplisse sans attendre les auteurs prolifiques jusqu'à la dernière page.
  for (let waveStart = 0; waveStart < MAX_AUTHOR_RESULTS_PER_SOURCE; waveStart += pageSize * pageConcurrency) {
    const offsets = Array.from({ length: pageConcurrency }, (_, index) => waveStart + index * pageSize)
      .filter(offset => offset < MAX_AUTHOR_RESULTS_PER_SOURCE);
    const settled = await Promise.allSettled(offsets.map(offset => source.search(query, language, offset, "author")));

    let shouldStop = false;
    let addedThisWave = 0;
    let rejectedInFirstPage = false;
    for (let index = 0; index < settled.length; index++) {
      const result = settled[index];
      if (result.status === "rejected") {
        if (waveStart === 0 && index === 0) rejectedInFirstPage = true;
        continue;
      }
      const page = result.value;
      if (!page.length) { shouldStop = true; continue; }
      for (const book of page) {
        const key = sourceResultKey(book);
        if (seen.has(key)) continue;
        seen.add(key);
        collected.push(book);
        addedThisWave++;
      }
      if (page.length < pageSize) shouldStop = true;
    }

    if (rejectedInFirstPage && collected.length === 0) {
      // Rien du tout : on laisse l'appelant basculer sur la source de secours.
      const first = settled[0];
      throw first.status === "rejected" ? first.reason : new Error("Source indisponible.");
    }
    if (addedThisWave > 0) onWave?.(collected);
    if (shouldStop || addedThisWave === 0) break;
  }
  return collected;
}

const completeAuthorCache = new Map<string, Promise<BookSearchResult[]>>();

/**
 * Mode fast-first : en mode « Toutes les sources », la bibliographie complète provient
 * d'une seule source principale (français : BnF ; autres langues : Open Library),
 * l'autre ne servant que de secours. Les résultats sont publiés vague par vague.
 */
export async function searchCompleteAuthorBibliography(
  q: string,
  p: SearchProvider,
  language: BookSearchLanguage = "all",
  forceRefresh = false,
  onProgress?: SearchProgress,
  onNotice?: SearchNotice
): Promise<BookSearchResult[]> {
  q = q.trim();
  if (!q) return [];

  const cacheKey = `${p}::${language}::${normalize(q)}`;
  if (forceRefresh) completeAuthorCache.delete(cacheKey);
  const cached = completeAuthorCache.get(cacheKey);
  if (cached) return cached;

  const publish = (books: BookSearchResult[]) => onProgress?.(prepare(books, language));

  const promise = (async () => {
    if (p !== "all") {
      const source = p === "bnf" ? bnf : p === "open-library" ? openLibrary : googleBooks;
      return prepare(await fetchCompleteAuthorSource(source, q, language, publish), language);
    }

    const primary = language === "fr" || language === "all" ? bnf : openLibrary;
    const fallback = primary.id === "bnf" ? openLibrary : bnf;
    try {
      const books = await fetchCompleteAuthorSource(primary, q, language, publish);
      if (books.length) return prepare(books, language);
    } catch {
      // on essaie la source de secours juste après
    }
    onNotice?.(`${sourceLabel(primary)} est injoignable ou sans résultat : bibliographie issue de ${sourceLabel(fallback)}, probablement incomplète.`);
    return prepare(await fetchCompleteAuthorSource(fallback, q, language, publish), language);
  })();

  completeAuthorCache.set(cacheKey, promise);
  try {
    return await promise;
  } catch (error) {
    completeAuthorCache.delete(cacheKey);
    throw error;
  }
}

/**
 * Message lisible pour une erreur de recherche. Les erreurs HTTP brutes
 * (« HTTP 429 while requesting www.googleapis.com ») ne disent pas quoi faire.
 */
export function friendlySearchError(error: unknown, hasGoogleKey: boolean): string {
  const message = error instanceof Error ? error.message : String(error);
  const match = /^HTTP (\d{3}) while requesting (\S+)/.exec(message);
  if (!match) return message || "Recherche impossible.";
  const [, status, host] = match;
  const label = host.includes("googleapis") ? "Google Books" : host.includes("bnf.fr") ? "BnF" : host.includes("openlibrary") ? "Open Library" : host;
  if (status === "429") {
    const advice = label === "Google Books" && !hasGoogleKey
      ? "Sans clé, son quota anonyme est partagé et souvent épuisé : ajoute une clé gratuite dans Paramètres, ou choisis « Toutes les sources »."
      : "Réessaie dans quelques minutes.";
    return `${label} limite le nombre de requêtes (quota atteint). ${advice}`;
  }
  return `${label} est momentanément indisponible (erreur ${status}). Réessaie dans un instant ou change de source.`;
}
