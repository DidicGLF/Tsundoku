import {
  GoogleBooksClient, betterCover, canonicalAuthorDisplay, canonicalIsbn, cleanCatalogTitle, cleanIsbn, getJson, isbn13To10, isExactCover,
  isConfidentCoverMatch, isSameEdition, mergeSearchResults,
  type BookSearchLanguage, type BookSearchResult
} from "@tsundoku/book-sources";
import { COVER_SOURCES } from "./coverSources";
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
/** Une requête d'en-têtes (~0,16 s) par livre : 4 en parallèle, 300 livres en une dizaine de secondes. */
const AMAZON_LOOKUP_LIMIT = 300;
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
        // Adresse par ISBN : c'est la jaquette de cette édition, pas celle d'une autre de la même œuvre.
        if (cover?.large ?? cover?.medium ?? cover?.small) {
          for (const book of byIsbn.get(isbn) ?? []) covers.set(coverKey(book), `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg`);
        }
      }
    } catch {
      // Une panne de l'API de jaquettes ne doit jamais bloquer l'application.
    }
    return covers;
  });

  for (const covers of partials) for (const [key, url] of covers) result.set(key, url);
  return result;
}

/** ISBN-10 d'un livre : l'adresse d'images d'Amazon n'accepte que lui. */
function isbn10Of(book: BookSearchResult): string | undefined {
  const own = cleanIsbn(book.isbn10);
  if (own?.length === 10) return own;
  const isbn13 = canonicalIsbn(book);
  return isbn13 ? isbn13To10(isbn13) : undefined;
}

/** Adresse de la jaquette Amazon d'un livre, si elle existe (une requête d'en-têtes). */
export async function findAmazonCover(book: BookSearchResult): Promise<string | undefined> {
  if (!COVER_SOURCES.amazon) return undefined;
  const found = await coversFromAmazon([book]);
  return found.get(coverKey(book));
}

/**
 * Amazon répond toujours 200 : pour un livre inconnu l'image fait 43 octets (pixel vide).
 * Une requête HEAD suffit donc à savoir si la jaquette existe, sans la télécharger.
 */
async function coversFromAmazon(books: BookSearchResult[]): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  await mapWithConcurrency(books, 4, async book => {
    const isbn = isbn10Of(book);
    if (!isbn) return;
    const url = `https://images-na.ssl-images-amazon.com/images/P/${isbn}.01.LZZZZZZZ.jpg`;
    try {
      const response = await fetch(url, { method: "HEAD" });
      const size = Number(response.headers.get("content-length") ?? 0);
      if (response.ok && size > 2000) found.set(coverKey(book), url);
      else if (response.ok) rememberMiss(book, Date.now(), "amazon");
    } catch {
      // réseau ou blocage : on réessaiera, ce n'est pas un « livre sans jaquette »
    }
  });
  return found;
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
 *  2b. Amazon par ISBN-10 (interrupteur dans coverSources.ts) ;
 *  3. Open Library par titre pour le reste ; 4. Google Books, seulement si une clé est configurée
 *     (gain mesuré faible sur les bibliographies : l'essentiel vient d'Open Library).
 */
export async function enrichSearchResults(
  books: BookSearchResult[],
  language: BookSearchLanguage,
  onProgress?: (books: BookSearchResult[]) => void,
  /** Appelé une fois à la fin ; `truncated` : un plafond a laissé des livres non vérifiés. */
  onDone?: (status: { truncated: boolean }) => void
): Promise<BookSearchResult[]> {
  let current = withCachedCovers(books);
  let truncated = false;
  const publish = () => rankByLanguage(mergeSearchResults(current), language);

  const apply = (covers: Map<string, string>) => {
    if (!covers.size) return;
    current = current.map(book => {
      const found = covers.get(coverKey(book));
      if (!found) return book;
      // Une jaquette exacte (par ISBN) remplace celle d'une autre édition ; jamais l'inverse.
      const next = betterCover(book.coverUrl, found);
      if (next === book.coverUrl) return book;
      rememberCover(book, next!);
      return { ...book, coverUrl: next };
    });
    onProgress?.(publish());
  };

  /** Un livre à ISBN dont la jaquette n'est pas (encore) celle de son édition. */
  const needsExact = (book: BookSearchResult) => hasIsbn(book) && !isExactCover(book.coverUrl);

  /** Recherche par titre, par lots : chaque lot trouvé est publié tout de suite. */
  const titleStage = async (candidates: BookSearchResult[]) => {
    const eligible = candidates.filter(book => !book.coverUrl && !recentlyMissed(book));
    if (eligible.length > TITLE_LOOKUP_LIMIT) truncated = true;
    const todo = eligible.slice(0, TITLE_LOOKUP_LIMIT);
    for (let start = 0; start < todo.length; start += BATCH_SIZE) apply(await coversFromTitle(todo.slice(start, start + BATCH_SIZE)));
  };

  /** Amazon, pour les livres à ISBN dont la jaquette n'est pas encore celle de leur édition. */
  const amazonStage = async () => {
    if (!COVER_SOURCES.amazon) return;
    const eligible = current.filter(book => needsExact(book) && !recentlyMissed(book, Date.now(), "amazon"));
    if (eligible.length > AMAZON_LOOKUP_LIMIT) truncated = true;
    const todo = eligible.slice(0, AMAZON_LOOKUP_LIMIT);
    for (let start = 0; start < todo.length; start += BATCH_SIZE) apply(await coversFromAmazon(todo.slice(start, start + BATCH_SIZE)));
  };

  // Les lots d'ISBN (une requête pour 50 livres) puis Amazon, et les notices sans ISBN, avancent en parallèle.
  await Promise.all([
    coversFromIsbn(current.filter(needsExact)).then(apply).then(amazonStage),
    titleStage(current.filter(book => !hasIsbn(book)))
  ]);
  await titleStage(current.filter(book => !book.coverUrl));

  if (COVER_SOURCES.googleBooks && (await hasGoogleKey())) {
    const eligible = current.filter(book => !book.coverUrl && !recentlyMissed(book));
    if (eligible.length > GOOGLE_LOOKUP_LIMIT) truncated = true;
    apply(await coversFromGoogle(eligible.slice(0, GOOGLE_LOOKUP_LIMIT)));
  }

  onDone?.({ truncated });
  return publish();
}
