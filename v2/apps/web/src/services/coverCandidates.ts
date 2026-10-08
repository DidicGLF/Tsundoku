import { cleanIsbn, getJson, type BookSearchResult } from "@tsundoku/book-sources";
import { findAmazonCover } from "./covers";

export interface CoverCandidate {
  id: string;
  /** Image à enregistrer. */
  url: string;
  /** Miniature pour la grille. */
  thumb: string;
  label: string;
  /** Jaquette de cette édition précise (adresse par ISBN). */
  exact: boolean;
}

export interface WorkEdition {
  covers?: number[];
  publishers?: string[];
  publish_date?: string;
  languages?: Array<{ key?: string }>;
}

interface Inputs {
  isbn: string;
  exactOpenLibrary: boolean;
  amazonUrl?: string;
  /** Jaquettes de l'édition elle-même (la première est celle de l'adresse par ISBN). */
  editionCovers: number[];
  workCovers: number[];
  otherEditions: WorkEdition[];
}

const large = (id: number) => `https://covers.openlibrary.org/b/id/${id}-L.jpg`;
const medium = (id: number) => `https://covers.openlibrary.org/b/id/${id}-M.jpg`;
const isFrench = (edition: WorkEdition) => (edition.languages ?? []).some(language => language.key === "/languages/fre");

/**
 * Ordonne les jaquettes candidates : celles de l'édition (par ISBN, Amazon, autres images de la même
 * édition), puis celles des autres éditions de l'œuvre, françaises d'abord. Sans doublon.
 */
export function assembleCandidates(input: Inputs): CoverCandidate[] {
  const out: CoverCandidate[] = [];
  const seen = new Set<number>();
  const own = input.editionCovers[0];
  if (own) seen.add(own);

  if (!input.exactOpenLibrary && own) {
    // L'adresse par ISBN n'a pas répondu : on propose quand même la jaquette enregistrée pour cette édition.
    out.push({ id: `ed-${own}`, url: large(own), thumb: medium(own), label: "Cette édition (Open Library)", exact: true });
  }
  if (input.exactOpenLibrary) {
    const url = `https://covers.openlibrary.org/b/isbn/${input.isbn}-L.jpg`;
    out.push({ id: "ol-isbn", url, thumb: `https://covers.openlibrary.org/b/isbn/${input.isbn}-M.jpg`, label: "Cette édition (Open Library)", exact: true });
  }
  if (input.amazonUrl) out.push({ id: "amazon", url: input.amazonUrl, thumb: input.amazonUrl, label: "Cette édition (Amazon)", exact: true });

  for (const id of input.editionCovers.slice(1)) {
    if (id > 0 && !seen.has(id)) { seen.add(id); out.push({ id: `ed-${id}`, url: large(id), thumb: medium(id), label: "Cette édition, autre image", exact: true }); }
  }

  const editions = [...input.otherEditions].sort((a, b) => Number(isFrench(b)) - Number(isFrench(a)));
  for (const edition of editions) {
    const year = /\b(\d{4})\b/.exec(edition.publish_date ?? "")?.[1];
    const label = `${edition.publishers?.[0] ?? "Autre édition"}${year ? ` ${year}` : ""}${isFrench(edition) ? " · FR" : ""}`;
    for (const id of edition.covers ?? []) {
      if (id > 0 && !seen.has(id)) { seen.add(id); out.push({ id: `w-${id}`, url: large(id), thumb: medium(id), label, exact: false }); }
    }
  }
  for (const id of input.workCovers) {
    if (id > 0 && !seen.has(id)) { seen.add(id); out.push({ id: `w-${id}`, url: large(id), thumb: medium(id), label: "Autre édition", exact: false }); }
  }
  return out.slice(0, 30);
}

/** Vrai si l'image existe : on la charge, sans dépendre des règles CORS. */
function imageLoads(url: string, timeoutMs = 8000): Promise<boolean> {
  return new Promise(resolve => {
    const image = new Image();
    const timer = setTimeout(() => resolve(false), timeoutMs);
    image.onload = () => { clearTimeout(timer); resolve(image.naturalWidth > 1); };
    image.onerror = () => { clearTimeout(timer); resolve(false); };
    image.src = url;
  });
}

/** Cherche les jaquettes possibles d'un livre : celle de son ISBN d'abord, puis celles de l'œuvre. */
export async function fetchCoverCandidates(book: Pick<BookSearchResult, "isbn13" | "isbn10">): Promise<CoverCandidate[]> {
  const isbn = cleanIsbn(book.isbn13) ?? cleanIsbn(book.isbn10);
  if (!isbn) return [];

  const [exactOpenLibrary, amazonUrl, edition] = await Promise.all([
    imageLoads(`https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`),
    findAmazonCover({ source: "manual", sourceId: "", title: "", authors: [], isbn13: book.isbn13, isbn10: book.isbn10 }).catch(() => undefined),
    getJson<{ covers?: number[]; works?: Array<{ key?: string }> }>(`https://openlibrary.org/isbn/${isbn}.json`, { timeoutMs: 8000, retries: 0 }).catch(() => null)
  ]);

  const workKey = edition?.works?.[0]?.key;
  const [work, editions] = workKey
    ? await Promise.all([
        getJson<{ covers?: number[] }>(`https://openlibrary.org${workKey}.json`, { timeoutMs: 8000, retries: 0 }).catch(() => null),
        getJson<{ entries?: WorkEdition[] }>(`https://openlibrary.org${workKey}/editions.json?limit=50`, { timeoutMs: 10000, retries: 0 }).catch(() => null)
      ])
    : [null, null];

  return assembleCandidates({
    isbn, exactOpenLibrary, amazonUrl,
    editionCovers: edition?.covers ?? [],
    workCovers: work?.covers ?? [],
    otherEditions: editions?.entries ?? []
  });
}
