import { canonicalAuthorIdentity } from "./authors";
import type { BookSearchResult } from "./types";

/** Minimal shape shared by search results and library books. */
export interface BookIdentity {
  title: string;
  authors: string[];
  isbn10?: string;
  isbn13?: string;
}

/** Lowercase, accent-free, letters-and-digits-only (any script) form used to compare free text. */
export function normalizeText(value: string): string {
  return value.normalize("NFD").replace(/\p{M}+/gu, "").toLocaleLowerCase("fr").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** Returns a bare 10 or 13 character ISBN, or undefined when the value cannot be one. */
export function cleanIsbn(value?: string): string | undefined {
  const isbn = value?.replace(/[^0-9Xx]/g, "").toUpperCase();
  return isbn && (isbn.length === 10 || isbn.length === 13) ? isbn : undefined;
}

/** ISBN-13 en 978… → ISBN-10 (les 979… n'en ont pas). */
export function isbn13To10(value: string): string | undefined {
  const isbn13 = cleanIsbn(value);
  if (!isbn13 || isbn13.length !== 13 || !isbn13.startsWith("978") || !/^\d{13}$/.test(isbn13)) return undefined;
  const core = isbn13.slice(3, 12);
  const sum = [...core].reduce((total, digit, index) => total + (10 - index) * Number(digit), 0);
  const check = (11 - (sum % 11)) % 11;
  return `${core}${check === 10 ? "X" : check}`;
}

export function isbn10To13(value: string): string | undefined {
  const isbn10 = cleanIsbn(value);
  if (!isbn10 || isbn10.length !== 10 || !/^\d{9}[\dX]$/.test(isbn10)) return undefined;
  const base = `978${isbn10.slice(0, 9)}`;
  const sum = [...base].reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);
  return `${base}${(10 - (sum % 10)) % 10}`;
}

/** ISBN-13 for a book, converting its ISBN-10 when needed. */
export function canonicalIsbn(book: Pick<BookIdentity, "isbn10" | "isbn13">): string | undefined {
  const isbn13 = cleanIsbn(book.isbn13);
  if (isbn13?.length === 13) return isbn13;
  const isbn10 = cleanIsbn(book.isbn10);
  return isbn10?.length === 10 ? isbn10To13(isbn10) : undefined;
}

function titleAuthorKey(book: BookIdentity): string {
  return `${normalizeText(book.title)}::${normalizeText(book.authors[0] ?? "")}`;
}

/** Fills the gaps of `preferred` with data from `other`. */
function fillMissing(preferred: BookSearchResult, other: BookSearchResult): BookSearchResult {
  return {
    ...preferred,
    authors: preferred.authors.length ? preferred.authors : other.authors,
    publishedYear: preferred.publishedYear ?? other.publishedYear,
    publisher: preferred.publisher ?? other.publisher,
    isbn10: preferred.isbn10 ?? other.isbn10,
    isbn13: preferred.isbn13 ?? other.isbn13,
    pageCount: preferred.pageCount ?? other.pageCount,
    language: preferred.language ?? other.language,
    description: preferred.description ?? other.description,
    coverUrl: preferred.coverUrl ?? other.coverUrl,
    seriesName: preferred.seriesName ?? other.seriesName,
    seriesVolume: preferred.seriesVolume ?? other.seriesVolume
  };
}

/** Merges two records of the same book, keeping the one that has a cover as base. */
export function mergeBooks(previous: BookSearchResult, next: BookSearchResult): BookSearchResult {
  const base = previous.coverUrl ? previous : next.coverUrl ? next : previous;
  return fillMissing(base, base === previous ? next : previous);
}

/** Dedupes search results by ISBN-13 when known, otherwise by title and first author. */
export function mergeSearchResults(books: BookSearchResult[]): BookSearchResult[] {
  const unique = new Map<string, BookSearchResult>();
  for (const book of books) {
    const isbn = canonicalIsbn(book);
    const key = isbn ? `isbn:${isbn}` : `text:${titleAuthorKey(book)}`;
    const previous = unique.get(key);
    unique.set(key, previous ? mergeBooks(previous, book) : book);
  }
  return [...unique.values()];
}

/**
 * Same *edition*: two known ISBNs must be equal. Without both ISBNs, falls back
 * to the title plus a loose first-author comparison.
 */
export function isSameEdition(a: BookIdentity, b: BookIdentity): boolean {
  const aIsbn = canonicalIsbn(a);
  const bIsbn = canonicalIsbn(b);
  if (aIsbn && bIsbn) return aIsbn === bIsbn;
  const titleA = normalizeText(a.title);
  if (!titleA || titleA !== normalizeText(b.title)) return false;
  const authorA = normalizeText(a.authors[0] ?? "");
  const authorB = normalizeText(b.authors[0] ?? "");
  return !authorA || !authorB || authorA === authorB || authorA.includes(authorB) || authorB.includes(authorA);
}

/**
 * Same *work*: a shared ISBN matches, but different ISBNs do not rule it out
 * (another edition of the same title and author is still the same work).
 */
export function isSameWork(a: BookIdentity, b: BookIdentity): boolean {
  const isbn13A = a.isbn13?.replace(/\D/g, "");
  if (isbn13A && isbn13A === b.isbn13?.replace(/\D/g, "")) return true;
  const isbn10A = a.isbn10?.replace(/[^0-9Xx]/g, "").toUpperCase();
  if (isbn10A && isbn10A === b.isbn10?.replace(/[^0-9Xx]/g, "").toUpperCase()) return true;
  const title = normalizeText(workTitle(a.title));
  if (!title || title !== normalizeText(workTitle(b.title))) return false;
  return shareAuthor(a.authors, b.authors);
}

const authorTokens = (name: string) => new Set(canonicalAuthorIdentity(name).split(" ").filter(Boolean));

/**
 * Même auteur, même quand l'un des noms est incomplet : « Eddings » est « David Eddings »
 * (tous les mots du nom le plus court se retrouvent dans le plus long). « Leigh Eddings »
 * n'est pas « David Eddings ». À n'utiliser qu'avec un autre indice, comme le titre.
 */
export function isSameAuthorName(a: string, b: string): boolean {
  const tokensA = authorTokens(a);
  const tokensB = authorTokens(b);
  if (!tokensA.size || !tokensB.size) return false;
  const [small, big] = tokensA.size <= tokensB.size ? [tokensA, tokensB] : [tokensB, tokensA];
  return [...small].every(token => big.has(token));
}

/**
 * Two author lists are compatible when either is unknown or they share an author
 * (co-written books: « David et Leigh Eddings » matches « David Eddings »).
 */
export function shareAuthor(a: string[], b: string[]): boolean {
  const known = (authors: string[]) => authors.filter(name => authorTokens(name).size);
  const listA = known(a);
  const listB = known(b);
  if (!listA.length || !listB.length) return true;
  return listA.some(x => listB.some(y => isSameAuthorName(x, y)));
}

/** Mentions de genre que le catalogue ajoute après « : » ; ce ne sont pas de vrais sous-titres. */
const GENERIC_SUBTITLE = /\s:\s*(roman|romans|thriller|thrillers|nouvelles?|récit|récits|essai|poèmes?|poésie|policier|roman policier|polar|science-fiction|fantasy|théâtre|pièce|témoignage|document|contes?|bande dessinée|bd|manga|album|biographie|autobiographie|texte intégral|édition intégrale|intégrale)\s*$/i;

/**
 * Mention de série collée au titre par certaines sources (Open Library : « Le trone de diamant la
 * trilogie des joyaux I »). Seulement quand elle finit par un numéro de tome, pour ne pas toucher
 * au titre d'un intégral (« La trilogie des joyaux »).
 */
const SERIES_SUFFIX = /\s+(?:(?:la|le|les)\s+)?(?:trilogie|tétralogie|tetralogie|pentalogie|saga|cycle|série|serie)\s+(?:(?:de|du|des|la|le|les)\s+|d['’]|l['’])?[\p{L}'’ -]+?\s+(?:[IVX]{1,5}|\d{1,2})\s*$/iu;
const VOLUME_SUFFIX = /\s+(?:tome|t\.|vol\.?|volume|livre)\s*(?:[IVX]{1,5}|\d{1,2})\s*$/iu;

/**
 * Titre d'œuvre, sans bruit de catalogue : mention de responsabilité (« / Nicolas Beuglet »),
 * mention d'édition entre parenthèses ou crochets en fin de titre, mention de genre (« : thriller »).
 * Les vrais sous-titres sont conservés (« Astérix : Le Gaulois » ≠ « Astérix : La Serpe d'or »).
 */
export function workTitle(title: string): string {
  let t = title.split(/\s\/\s?/)[0].trim();
  for (let previous = ""; previous !== t;) {
    previous = t;
    t = t.replace(/\s*(\([^)]*\)?|\[[^\]]*\]?)\s*$/, "").replace(GENERIC_SUBTITLE, "").replace(SERIES_SUFFIX, "").replace(VOLUME_SUFFIX, "").trim();
  }
  return t.replace(/[\s.,;:]+$/g, "") || title;
}

/** Collapses editions into works (title + canonical author) and sorts newest first. */
export function collapseToWorks(results: BookSearchResult[]): BookSearchResult[] {
  const works = new Map<string, BookSearchResult>();
  for (const book of results) {
    const key = `${normalizeText(workTitle(book.title))}::${canonicalAuthorIdentity(book.authors[0] ?? "")}`;
    const previous = works.get(key);
    if (!previous) { works.set(key, book); continue; }
    // On affiche le titre le plus court des éditions regroupées (le moins chargé de bruit de catalogue).
    const title = previous.title.length <= book.title.length ? previous.title : book.title;
    works.set(key, { ...mergeBooks(previous, book), title });
  }
  return [...works.values()].sort((a, b) => (b.publishedYear ?? -1) - (a.publishedYear ?? -1) || a.title.localeCompare(b.title, "fr"));
}

/**
 * Notice BnF sans auteur ni ISBN : fiche de collection, document sans identifiant exploitable.
 * Impossible à rattacher à un auteur, à dédoublonner ou à illustrer : on l'écarte.
 */
export function isUnusableNotice(book: { source: string; authors: string[]; isbn10?: string; isbn13?: string }): boolean {
  return book.source === "bnf"
    && !book.authors.some(name => name.trim())
    && !cleanIsbn(book.isbn13)
    && !cleanIsbn(book.isbn10);
}

/**
 * Catalogue titles carry cataloguing noise: "Dune ; (suivi de) Le Messie de Dune : roman /",
 * "Avant Dune / Brian Herbert". Keeps the main title only, so it can be matched elsewhere.
 */
export function cleanCatalogTitle(title: string): string {
  const main = title.split(/\s[/:;]\s|\s\(|\s*\[/)[0];
  return main.replace(/[\s.,;:/]+$/g, "").trim();
}

/**
 * Strict match used to borrow a cover from another catalogue: same main title and a
 * shared author surname. Fuzzy matches are worse than no cover ("Après Dune" is not
 * "Les trois Mousquetaires").
 */
export function isConfidentCoverMatch(wanted: BookIdentity, candidate: { title?: string; author_name?: string[] }): boolean {
  const title = normalizeText(cleanCatalogTitle(wanted.title));
  if (!title || title !== normalizeText(cleanCatalogTitle(candidate.title ?? ""))) return false;
  const wantedAuthor = canonicalAuthorIdentity(wanted.authors[0] ?? "");
  if (!wantedAuthor) return true;
  const surname = wantedAuthor.split(" ").pop() ?? wantedAuthor;
  return (candidate.author_name ?? []).some(name => canonicalAuthorIdentity(name).split(" ").includes(surname));
}
