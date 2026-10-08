import type { BookMetadata, BookSearchField, BookSearchLanguage, BookSearchResult, BookSource } from "../types";
import { getJson } from "../http";
import { isbn10To13, isbn13To10 } from "../matching";
import { mapOpenLibraryDoc, mapOpenLibraryEditionData, mapOpenLibraryWork, type OpenLibraryDoc, type OpenLibraryEditionData, type OpenLibraryWork } from "./mapper";

const openLibraryLanguages: Record<Exclude<BookSearchLanguage, "all">, string> = {
  fr: "fre",
  en: "eng",
  de: "ger",
  es: "spa",
  it: "ita"
};

const openLibraryPrefix: Record<Exclude<BookSearchField, "author">, string> = {
  all: "",
  title: "title:",
  isbn: "isbn:"
};

interface OpenLibraryAuthorDoc {
  key?: string;
  name?: string;
}

interface OpenLibraryAuthorSearchResponse {
  docs?: OpenLibraryAuthorDoc[];
}

interface OpenLibraryAuthorWorksResponse {
  entries?: OpenLibraryWork[];
  size?: number;
}

interface OpenLibraryEditionDoc {
  key?: string;
  title?: string;
  publisher?: string[];
  isbn?: string[];
  isbn_10?: string[];
  isbn_13?: string[];
  number_of_pages?: number;
  language?: string[];
  cover_i?: number;
  publish_date?: string;
}

interface OpenLibraryEditionGroup {
  docs?: OpenLibraryEditionDoc[];
}

interface OpenLibraryWorkWithEditions extends OpenLibraryDoc {
  editions?: OpenLibraryEditionGroup;
}

interface OpenLibraryEditionLanguage {
  key?: string;
}

interface OpenLibraryWorkEdition {
  series?: string | string[];
  languages?: OpenLibraryEditionLanguage[];
}

interface OpenLibraryWorkEditionsResponse {
  entries?: OpenLibraryWorkEdition[];
}

interface ParsedSeries {
  seriesName?: string;
  seriesVolume?: number;
}

function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function cleanIsbn(value: string): string {
  return value.replace(/[^0-9Xx]/g, "").toUpperCase();
}

function editionCover(id?: number): string | undefined {
  return id ? `https://covers.openlibrary.org/b/id/${id}-L.jpg` : undefined;
}

function normalizeSeriesName(value: string): string | undefined {
  const name = value
    .replace(/^\s*[\[(]+|[\])]+\s*$/g, "")
    .replace(/\s+/g, " ")
    .replace(/[,:;\-–—]\s*$/g, "")
    .trim();
  return name || undefined;
}

function parseVolume(value?: string): number | undefined {
  if (!value) return undefined;
  const number = Number(value.replace(",", "."));
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

/**
 * Open Library stocke souvent la série au niveau Edition, sous des formes comme
 * "The Belgariad -- bk.1" ou "Belgariad -- 2".
 */
function parseEditionSeries(value: string): ParsedSeries {
  const raw = value.replace(/\s+/g, " ").trim();
  if (!raw) return {};

  const patterns = [
    /^(.*?)\s*(?:--|[-–—])\s*(?:bk\.?|book|vol\.?|volume|tome|t\.?|no\.?|#)?\s*(\d+(?:[.,]\d+)?)\s*$/i,
    /^(.*?)\s*[,;:]\s*(?:bk\.?|book|vol\.?|volume|tome|t\.?|no\.?|#)\s*(\d+(?:[.,]\d+)?)\s*$/i,
    /^(.*?)\s+(?:bk\.?|book|vol\.?|volume|tome|t\.?|no\.?|#)\s*(\d+(?:[.,]\d+)?)\s*$/i
  ];

  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match) {
      return {
        seriesName: normalizeSeriesName(match[1] ?? ""),
        seriesVolume: parseVolume(match[2])
      };
    }
  }

  return { seriesName: normalizeSeriesName(raw) };
}

function editionLanguageCode(edition: OpenLibraryWorkEdition): string | undefined {
  const key = edition.languages?.[0]?.key;
  return key?.replace(/^\/languages\//, "");
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await work(items[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

export class OpenLibraryClient implements BookSource {
  readonly id = "open-library" as const;
  private readonly editionSeriesCache = new Map<string, Promise<ParsedSeries>>();

  constructor(private readonly base = "https://openlibrary.org") {}

  private async findAuthor(query: string): Promise<OpenLibraryAuthorDoc | null> {
    const p = new URLSearchParams({ q: query, limit: "10" });
    const data = await getJson<OpenLibraryAuthorSearchResponse>(`${this.base}/search/authors.json?${p}`);
    const authors = (data.docs ?? []).filter(author => author.key && author.name);
    if (!authors.length) return null;

    const wanted = normalizeName(query);
    return authors.find(author => normalizeName(author.name ?? "") === wanted) ?? authors[0] ?? null;
  }

  private async findSeriesFromEditions(workId: string, language: BookSearchLanguage): Promise<ParsedSeries> {
    const id = workId.replace(/^\/works\//, "");
    if (!id) return {};

    const cacheKey = `${id}::${language}`;
    const cached = this.editionSeriesCache.get(cacheKey);
    if (cached) return cached;

    const promise = (async (): Promise<ParsedSeries> => {
      try {
        const p = new URLSearchParams({ limit: "50" });
        const data = await getJson<OpenLibraryWorkEditionsResponse>(
          `${this.base}/works/${encodeURIComponent(id)}/editions.json?${p}`
        );

        const candidates = (data.entries ?? []).flatMap(edition => {
          const values = Array.isArray(edition.series) ? edition.series : edition.series ? [edition.series] : [];
          return values
            .map(series => ({ ...parseEditionSeries(series), language: editionLanguageCode(edition) }))
            .filter(item => item.seriesName);
        });

        if (!candidates.length) return {};
        if (language === "all") return candidates[0];

        const wanted = openLibraryLanguages[language];
        return candidates.find(candidate => candidate.language === wanted) ?? candidates[0];
      } catch {
        // Une édition mal renseignée ou une requête indisponible ne doit jamais
        // empêcher l'auteur complet de s'afficher.
        return {};
      }
    })();

    this.editionSeriesCache.set(cacheKey, promise);
    return promise;
  }

  /**
   * Recherche d'auteur dans une langue précise.
   *
   * Open Library sait sélectionner, dans le champ `editions`, l'édition qui
   * correspond au filtre language:xxx. On utilise donc directement Search API
   * ici au lieu de récupérer les Works puis d'essayer de deviner leur langue.
   * Une œuvre n'est retournée que si Open Library connaît réellement au moins
   * une édition dans la langue demandée.
   */
  private async searchAuthorInLanguage(
    authorKey: string,
    authorName: string,
    language: Exclude<BookSearchLanguage, "all">,
    offset: number
  ): Promise<BookSearchResult[]> {
    const wanted = openLibraryLanguages[language];
    const q = `author_key:${authorKey} language:${wanted}`;
    const p = new URLSearchParams({
      q,
      lang: language,
      limit: "40",
      offset: String(Math.max(0, offset)),
      fields: [
        "key", "title", "author_name", "first_publish_year",
        "editions", "editions.key", "editions.title", "editions.publisher",
        "editions.isbn", "editions.isbn_10", "editions.isbn_13",
        "editions.number_of_pages", "editions.language", "editions.cover_i",
        "editions.publish_date"
      ].join(",")
    });

    const data = await getJson<{ docs?: OpenLibraryWorkWithEditions[] }>(`${this.base}/search.json?${p}`);

    return (data.docs ?? []).flatMap(doc => {
      const edition = doc.editions?.docs?.[0];
      if (!edition) return [];

      const editionLanguages = edition.language ?? [];
      if (editionLanguages.length > 0 && !editionLanguages.includes(wanted)) return [];

      const work = mapOpenLibraryDoc(doc);
      const isbns = [
        ...(edition.isbn ?? []),
        ...(edition.isbn_10 ?? []),
        ...(edition.isbn_13 ?? [])
      ].map(cleanIsbn);

      return [{
        ...work,
        sourceId: work.sourceId,
        title: edition.title?.trim() || work.title,
        authors: work.authors.length ? work.authors : [authorName],
        publisher: edition.publisher?.[0],
        isbn10: isbns.find(value => value.length === 10),
        isbn13: isbns.find(value => value.length === 13),
        pageCount: edition.number_of_pages,
        language: wanted,
        coverUrl: editionCover(edition.cover_i) ?? work.coverUrl
      }];
    });
  }

  private async searchAuthorWorks(query: string, language: BookSearchLanguage, offset: number): Promise<BookSearchResult[]> {
    const author = await this.findAuthor(query);
    if (!author?.key) return [];

    const key = author.key.replace(/^\/authors\//, "");
    const p = new URLSearchParams({ limit: "40", offset: String(Math.max(0, offset)) });
    const data = await getJson<OpenLibraryAuthorWorksResponse>(`${this.base}/authors/${encodeURIComponent(key)}/works.json?${p}`);

    const works = (data.entries ?? []).map(work => ({
      ...mapOpenLibraryWork(work, work.key ?? ""),
      authors: [author.name ?? query]
    }));

    // La vue principale de Tsundoku ne dépend plus des séries. On renvoie les
    // œuvres immédiatement : les requêtes Edition supplémentaires ralentissaient
    // fortement les recherches auteur sans apporter une donnée assez fiable.
    return works;
  }

  async search(
    query: string,
    language: BookSearchLanguage = "all",
    offset = 0,
    field: BookSearchField = "all"
  ): Promise<BookSearchResult[]> {
    query = query.trim();
    if (!query) return [];

    if (field === "author") return this.searchAuthorWorks(query, language, offset);

    // Par ISBN, la fiche de l'édition exacte (titre, éditeur, jaquette de cette édition) prime sur
    // celle de l'œuvre, qui peut montrer l'ISBN et la jaquette d'une autre édition.
    if (field === "isbn") {
      const exact = await this.searchByIsbn(query);
      if (exact.length) return exact;
    }

    const q = `${openLibraryPrefix[field]}${query}`.trim();
    const values: Record<string, string> = {
      q,
      limit: "40",
      offset: String(Math.max(0, offset)),
      fields: "key,title,author_name,first_publish_year,publisher,isbn,number_of_pages_median,language,cover_i,first_sentence,subject"
    };
    const p = new URLSearchParams(values);
    const data = await getJson<{ docs?: OpenLibraryDoc[] }>(`${this.base}/search.json?${p}`);
    const books = (data.docs ?? []).map(mapOpenLibraryDoc);
    if (field !== "isbn") return books;
    // Sans fiche d'édition : la notice d'œuvre garde au moins l'ISBN demandé (pas celui d'une autre édition).
    const wanted = cleanIsbn(query);
    const wanted13 = wanted.length === 13 ? wanted : isbn10To13(wanted);
    const wanted10 = wanted.length === 10 ? wanted : isbn13To10(wanted);
    return books.map((book, index) => {
      const known = (data.docs?.[index]?.isbn ?? []).map(cleanIsbn);
      return known.includes(wanted) ? { ...book, isbn13: wanted13 ?? book.isbn13, isbn10: wanted10 ?? book.isbn10 } : book;
    });
  }

  private async searchByIsbn(query: string): Promise<BookSearchResult[]> {
    const isbn = cleanIsbn(query);
    if (isbn.length !== 10 && isbn.length !== 13) return [];
    const [data, edition] = await Promise.all([
      getJson<Record<string, OpenLibraryEditionData>>(`${this.base}/api/books?${new URLSearchParams({ bibkeys: `ISBN:${isbn}`, format: "json", jscmd: "data" })}`).catch(() => ({} as Record<string, OpenLibraryEditionData>)),
      getJson<{ languages?: Array<{ key?: string }> }>(`${this.base}/isbn/${isbn}.json`, { retries: 0 }).catch(() => null)
    ]);
    const entry = data[`ISBN:${isbn}`];
    return entry ? [mapOpenLibraryEditionData(entry, isbn, edition?.languages?.[0]?.key)] : [];
  }

  async getBook(id: string): Promise<BookMetadata> {
    id = id.trim();
    if (!id) throw new Error("Open Library work id cannot be empty.");
    const key = id.startsWith("/") ? id : `/works/${id.replace(/^works\//, "")}`;
    return mapOpenLibraryWork(await getJson<OpenLibraryWork>(`${this.base}${key}.json`), key);
  }
}
