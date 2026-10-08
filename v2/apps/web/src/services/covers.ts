import {
  GoogleBooksClient, canonicalAuthorDisplay, canonicalIsbn, cleanCatalogTitle, cleanIsbn, getJson,
  isConfidentCoverMatch, isSameEdition, mergeSearchResults,
  type BookSearchLanguage, type BookSearchResult
} from "@tsundoku/book-sources";
import { coverKey, recentlyMissed, rememberCover, rememberMiss, withCachedCovers } from "./coverCache";
import { getCredentialStore } from "./credentials";
import { rankByLanguage } from "./language";

const googleBooks = new GoogleBooksClient(getCredentialStore());

/*
 * Les recherches par titre coûtent une requête par livre. Mesuré sur de vraies bibliographies
 * (135 à 276 œuvres) : avec 30 requêtes par passage on couvre ~32 % des livres, avec 400 ~57 %,
 * en 30 à 60 s d'arrière-plan. 150 est un compromis qui reste poli envers Open Library ; les
 * échecs sont mémorisés, donc les ouvertures suivantes continuent là où la précédente s'est arrêtée.
 * Google compte un quota par clé (1000/jour) pour un gain mesuré faible : borne basse.
 */
const TITLE_LOOKUP_LIMIT = 150;
const GOOGLE_LOOKUP_LIMIT = 40;
/** Les jaquettes trouvées sont publiées par lots, pas à la toute fin. */
const BATCH_SIZE = 20;

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

  await mapWithConcurrency(books, 3, async book => {
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

/** `failed` : erreur réseau ou quota, à ne pas confondre avec « Google n'a pas de jaquette ». */
async function googleCover(book: BookSearchResult): Promise<{ url?: string; failed?: boolean }> {
  try {
    const isbn = canonicalIsbn(book) ?? cleanIsbn(book.isbn10);
    if (isbn) {
      const candidates = await googleBooks.search(isbn, "all", 0, "isbn");
      const exact = candidates.find(candidate => candidate.coverUrl && canonicalIsbn(candidate) === canonicalIsbn(book));
      const url = exact?.coverUrl ?? candidates.find(candidate => candidate.coverUrl)?.coverUrl;
      if (url) return { url };
    }
    const query = [book.title, book.authors[0]].filter(Boolean).join(" ");
    if (!query) return {};
    const candidates = await googleBooks.search(query, "all", 0, "all");
    return { url: candidates.find(candidate => candidate.coverUrl && isSameEdition(book, candidate))?.coverUrl };
  } catch {
    return { failed: true };
  }
}

/** Google Books : sans clé son quota anonyme est épuisé, on n'est appelé que si une clé existe. */
async function coversFromGoogle(books: BookSearchResult[]): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  await mapWithConcurrency(books, 3, async book => {
    const { url, failed } = await googleCover(book);
    if (url) found.set(coverKey(book), https(url));
    else if (!failed) rememberMiss(book);
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
 *  3. Open Library par titre pour le reste ; 4. Google Books, seulement si une clé est configurée
 *     (gain mesuré faible sur les bibliographies : l'essentiel vient d'Open Library).
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

  /** Recherche par titre, par lots : chaque lot trouvé est publié tout de suite. */
  const titleStage = async (candidates: BookSearchResult[]) => {
    const todo = candidates.filter(book => !book.coverUrl && !recentlyMissed(book)).slice(0, TITLE_LOOKUP_LIMIT);
    for (let start = 0; start < todo.length; start += BATCH_SIZE) apply(await coversFromTitle(todo.slice(start, start + BATCH_SIZE)));
  };

  // Les lots d'ISBN (une requête pour 50 livres) et les notices sans ISBN avancent en parallèle.
  await Promise.all([
    coversFromIsbn(current).then(apply),
    titleStage(current.filter(book => !hasIsbn(book)))
  ]);
  await titleStage(current.filter(book => !book.coverUrl));

  if (await hasGoogleKey()) {
    const todo = current.filter(book => !book.coverUrl && !recentlyMissed(book)).slice(0, GOOGLE_LOOKUP_LIMIT);
    apply(await coversFromGoogle(todo));
  }

  return publish();
}
