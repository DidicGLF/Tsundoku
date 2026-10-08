import {
  GoogleBooksClient, canonicalAuthorDisplay, canonicalIsbn, cleanCatalogTitle, cleanIsbn, getJson,
  isConfidentCoverMatch, isSameEdition, mergeSearchResults,
  type BookSearchLanguage, type BookSearchResult
} from "@tsundoku/book-sources";
import { coverKey, recentlyMissed, rememberCover, rememberMiss, withCachedCovers } from "./coverCache";
import { getCredentialStore } from "./credentials";
import { rankByLanguage } from "./language";

const googleBooks = new GoogleBooksClient(getCredentialStore());

/** Les recherches par titre sont une requête par livre : on borne leur nombre par passage. */
const LOOKUP_LIMIT = 30;

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

const https = (url: string) => url.replace(/^http:/, "https:");
const hasIsbn = (book: BookSearchResult) => Boolean(canonicalIsbn(book) ?? cleanIsbn(book.isbn10));

interface OpenLibraryBooksData {
  [key: string]: { cover?: { small?: string; medium?: string; large?: string } } | undefined;
}

/** Une requête Open Library par lot de 50 ISBN : la méthode la plus économique. */
async function coversFromIsbn(books: BookSearchResult[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const byIsbn = new Map<string, BookSearchResult[]>();
  for (const book of books) {
    if (book.coverUrl) continue;
    const isbn = canonicalIsbn(book) ?? cleanIsbn(book.isbn10);
    if (!isbn) continue;
    byIsbn.set(isbn, [...(byIsbn.get(isbn) ?? []), book]);
  }

  const isbns = [...byIsbn.keys()];
  const chunks: string[][] = [];
  for (let start = 0; start < isbns.length; start += 50) chunks.push(isbns.slice(start, start + 50));

  const partials = await mapWithConcurrency(chunks, 3, async chunk => {
    const covers = new Map<string, string>();
    try {
      const params = new URLSearchParams({ bibkeys: chunk.map(isbn => `ISBN:${isbn}`).join(","), format: "json", jscmd: "data" });
      const data = await getJson<OpenLibraryBooksData>(`https://openlibrary.org/api/books?${params}`, { timeoutMs: 10000 });
      for (const isbn of chunk) {
        const cover = data[`ISBN:${isbn}`]?.cover;
        const url = cover?.large ?? cover?.medium ?? cover?.small;
        if (url) for (const book of byIsbn.get(isbn) ?? []) covers.set(coverKey(book), https(url));
      }
    } catch {
      // Une panne de l'API de jaquettes ne doit jamais bloquer l'application.
    }
    return covers;
  });

  for (const covers of partials) for (const [key, url] of covers) result.set(key, url);
  return result;
}

/**
 * Jaquette d'une autre édition de la même œuvre, quand la notice (BnF) n'a pas d'ISBN
 * ou que l'édition est inconnue d'Open Library. La correspondance est stricte : mieux
 * vaut aucune jaquette qu'une jaquette d'un autre livre.
 */
async function coversFromTitle(books: BookSearchResult[]): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  const candidates = books.filter(book => !book.coverUrl && !recentlyMissed(book)).slice(0, LOOKUP_LIMIT);

  await mapWithConcurrency(candidates, 4, async book => {
    const title = cleanCatalogTitle(book.title);
    if (!title) return;
    const params = new URLSearchParams({ title, limit: "5", fields: "title,author_name,cover_i" });
    const author = canonicalAuthorDisplay(book.authors[0] ?? "");
    if (author && author !== "Auteur inconnu") params.set("author", author);
    try {
      const data = await getJson<{ docs?: Array<{ title?: string; author_name?: string[]; cover_i?: number }> }>(
        `https://openlibrary.org/search.json?${params}`, { timeoutMs: 8000, retries: 0 }
      );
      const hit = data.docs?.find(doc => doc.cover_i && isConfidentCoverMatch(book, doc));
      if (hit?.cover_i) found.set(coverKey(book), `https://covers.openlibrary.org/b/id/${hit.cover_i}-L.jpg`);
      else rememberMiss(book);
    } catch {
      // Service indisponible : on réessaiera au prochain passage.
    }
  });
  return found;
}

async function googleCover(book: BookSearchResult): Promise<string | undefined> {
  try {
    const isbn = canonicalIsbn(book) ?? cleanIsbn(book.isbn10);
    if (isbn) {
      const candidates = await googleBooks.search(isbn, "all", 0, "isbn");
      const exact = candidates.find(candidate => candidate.coverUrl && canonicalIsbn(candidate) === canonicalIsbn(book));
      const url = exact?.coverUrl ?? candidates.find(candidate => candidate.coverUrl)?.coverUrl;
      if (url) return url;
    }
    const query = [book.title, book.authors[0]].filter(Boolean).join(" ");
    if (!query) return undefined;
    const candidates = await googleBooks.search(query, "all", 0, "all");
    return candidates.find(candidate => candidate.coverUrl && isSameEdition(book, candidate))?.coverUrl;
  } catch {
    return undefined;
  }
}

/** Google Books : utile surtout pour l'édition française, mais sans clé son quota anonyme est épuisé. */
async function coversFromGoogle(books: BookSearchResult[]): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  const candidates = books.filter(book => !book.coverUrl && !recentlyMissed(book)).slice(0, LOOKUP_LIMIT);
  await mapWithConcurrency(candidates, 3, async book => {
    const url = await googleCover(book);
    if (url) found.set(coverKey(book), https(url));
    else rememberMiss(book);
  });
  return found;
}

async function hasGoogleKey(): Promise<boolean> {
  try { return Boolean(await getCredentialStore().getGoogleBooksApiKey()); } catch { return false; }
}

/**
 * Complète les jaquettes en arrière-plan, par étapes de la moins chère à la plus chère.
 * `onProgress` reçoit la liste à jour après chaque étape : les jaquettes apparaissent au
 * fil de l'eau au lieu d'attendre la plus lente.
 *  1. cache local ; 2. Open Library par ISBN (lots) et par titre pour les notices sans ISBN ;
 *  3. Open Library par titre pour le reste ; 4. Google Books, seulement si une clé est configurée.
 */
export async function enrichSearchResults(
  books: BookSearchResult[],
  language: BookSearchLanguage,
  onProgress?: (books: BookSearchResult[]) => void
): Promise<BookSearchResult[]> {
  let current = withCachedCovers(books);
  const publish = () => rankByLanguage(mergeSearchResults(current), language);

  const apply = (covers: Map<string, string>) => {
    if (!covers.size) return;
    current = current.map(book => {
      const url = book.coverUrl ? undefined : covers.get(coverKey(book));
      if (!url) return book;
      rememberCover(book, url);
      return { ...book, coverUrl: url };
    });
    onProgress?.(publish());
  };

  const [byIsbn, byTitle] = await Promise.all([
    coversFromIsbn(current),
    coversFromTitle(current.filter(book => !hasIsbn(book)))
  ]);
  apply(byIsbn);
  apply(byTitle);

  apply(await coversFromTitle(current.filter(book => !book.coverUrl)));

  if (await hasGoogleKey()) apply(await coversFromGoogle(current.filter(book => !book.coverUrl)));

  return publish();
}
