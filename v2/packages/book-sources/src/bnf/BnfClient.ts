import type { BookMetadata, BookSearchField, BookSearchLanguage, BookSearchResult, BookSource } from "../types";
import { canonicalAuthorDisplay } from "../authors";
import { getText } from "../http";
import { collectionBase, normalizeText } from "../matching";

const fieldCriterion: Record<BookSearchField, string> = {
  all: "bib.anywhere",
  title: "bib.title",
  author: "bib.author",
  isbn: "bib.isbn"
};

const PRINTED_TEXT = 'bib.doctype any "a"';

function quote(value: string): string {
  return `"${value.replace(/["\\]/g, " ").trim()}"`;
}

function cleanIsbn(value: string): string {
  return value.replace(/[^0-9Xx]/g, "").toUpperCase();
}

function firstYear(values: string[]): number | undefined {
  for (const value of values) {
    const match = value.match(/\b(1[0-9]{3}|20[0-9]{2})\b/);
    if (match) return Number(match[1]);
  }
  return undefined;
}

function textValues(record: Element, localName: string): string[] {
  return Array.from(record.getElementsByTagNameNS("*", localName))
    .map(node => node.textContent?.trim() ?? "")
    .filter(Boolean);
}

/** Lignes de notes du catalogue (code-barres, titre original, collection…) : ce ne sont pas des résumés. */
const CATALOGUE_NOTE = /^(Collection|Code à barres|Titre|Trad|Avec|Contient|Bibliogr|Index|Fait partie|Publié|Autre|Notice|Reprod|Texte|Illustr|Préf|Postf|Sous-titre|Variante|Dépôt|Ed\.|Édition|Les ouvrages|Comprend)[^:]{0,60}:/i;

/** « Collection : Pocket. Science-fiction : fantasy » → la plus précise des collections citées. */
export function collectionFromNotes(notes: string[]): string | undefined {
  const found = notes
    .map(note => /^Collection\s*:\s*(.+)$/i.exec(note)?.[1]?.trim())
    .filter((value): value is string => Boolean(value));
  return found.sort((a, b) => b.length - a.length)[0];
}

/** Un vrai résumé, s'il y en a un : le plus souvent la BnF n'en a pas. */
export function summaryFromNotes(notes: string[]): string | undefined {
  const labelled = notes.map(note => /^(?:Résumé|Quatrième de couverture)\s*:\s*(.+)$/is.exec(note)?.[1]?.trim()).find(Boolean);
  if (labelled) return labelled;
  return notes.find(note => note.length > 100 && !CATALOGUE_NOTE.test(note));
}

/** « 410 p. », « 1 vol. (XII-410 p.) » → 410. */
export function pageCountFromFormat(formats: string[]): number | undefined {
  for (const format of formats) {
    const match = /(\d{1,4})\s*p\b/.exec(format);
    if (match) return Number(match[1]);
  }
  return undefined;
}

export function mapRecord(record: Element): BookSearchResult | null {
  const titles = textValues(record, "title");
  if (!titles.length) return null;
  const creators = textValues(record, "creator").map(canonicalAuthorDisplay);
  const identifiers = textValues(record, "identifier");
  const isbnValues = identifiers
    .flatMap(value => value.match(/(?:97[89][0-9Xx -]{10,}|[0-9Xx -]{10,17})/g) ?? [])
    .map(cleanIsbn)
    .filter(value => value.length === 10 || value.length === 13);
  const ark = identifiers.find(value => value.includes("ark:/12148/"));
  const sourceId = ark?.match(/ark:\/12148\/([^\s/?#]+)/)?.[1]
    ?? identifiers[0]
    ?? `${titles[0]}-${creators[0] ?? ""}`;

  return {
    source: "bnf",
    sourceId,
    title: titles[0],
    authors: creators,
    publishedYear: firstYear(textValues(record, "date")),
    publisher: textValues(record, "publisher")[0],
    isbn10: isbnValues.find(value => value.length === 10),
    isbn13: isbnValues.find(value => value.length === 13),
    pageCount: pageCountFromFormat(textValues(record, "format")),
    language: textValues(record, "language")[0],
    description: summaryFromNotes(textValues(record, "description")),
    collection: collectionFromNotes(textValues(record, "description"))
  };
}

export interface SimilarBooksQuery {
  /** Nom d'éditeur (« Pocket »). */
  publisher?: string;
  author?: string;
  /** Collection (« Pocket. Science-fiction ») : les notices sont filtrées sur ce nom. */
  collection?: string;
}

export interface SimilarBooksPage {
  books: BookSearchResult[];
  /** Notices reçues avant filtrage : sert à savoir s'il reste des pages. */
  rawCount: number;
}

const SIMILAR_PAGE_SIZE = 100;

export class BnfClient implements BookSource {
  readonly id = "bnf" as const;

  constructor(private readonly base = "https://catalogue.bnf.fr/api/SRU") {}

  private async request(query: string, offset: number, maximumRecords = 40): Promise<BookSearchResult[]> {
    const params = new URLSearchParams({
      version: "1.2",
      operation: "searchRetrieve",
      query,
      recordSchema: "dublincore",
      startRecord: String(Math.max(0, offset) + 1),
      maximumRecords: String(maximumRecords)
    });
    const text = await getText(`${this.base}?${params}`, { headers: { Accept: "application/xml,text/xml" } });
    const xml = new DOMParser().parseFromString(text, "application/xml");
    if (xml.getElementsByTagName("parsererror").length) throw new Error("Réponse XML BnF invalide.");
    return Array.from(xml.getElementsByTagNameNS("*", "record")).flatMap(record => {
      const mapped = mapRecord(record);
      return mapped ? [mapped] : [];
    });
  }

  /**
   * Autres livres du même éditeur, de la même collection, du même auteur (ou une combinaison).
   * La BnF n'a pas d'index de collection : on cherche ses mots dans les notices, puis on garde
   * celles dont la ligne « Collection : … » correspond vraiment.
   */
  async searchSimilar(query: SimilarBooksQuery, offset = 0): Promise<SimilarBooksPage> {
    const parts: string[] = [];
    const wanted = collectionBase(query.collection);
    if (wanted) parts.push(`bib.anywhere all ${quote(wanted.replace(/[.:]/g, " ").replace(/\s+/g, " "))}`);
    else if (query.publisher) parts.push(`bib.publisher all ${quote(query.publisher)}`);
    if (query.author) parts.push(`bib.author all ${quote(query.author)}`);
    if (!parts.length) return { books: [], rawCount: 0 };
    parts.push(PRINTED_TEXT);

    const records = await this.request(parts.join(" and "), offset, SIMILAR_PAGE_SIZE);
    let books = records;
    if (wanted) {
      const needle = normalizeText(wanted);
      books = records.filter(book => normalizeText(collectionBase(book.collection) ?? "").includes(needle));
    } else if (query.publisher) {
      const needle = normalizeText(query.publisher);
      books = records.filter(book => normalizeText(book.publisher ?? "").includes(needle));
    }
    return { books, rawCount: records.length };
  }

  async search(query: string, _language: BookSearchLanguage = "all", offset = 0, field: BookSearchField = "all"): Promise<BookSearchResult[]> {
    query = query.trim();
    if (!query) return [];
    const criterion = fieldCriterion[field];
    const relation = field === "isbn" ? "adj" : "all";
    // « a » = texte imprimé : écarte disques, vidéos, cartes… Les requêtes sont plusieurs
    // fois plus rapides (la BnF renvoie beaucoup moins de notices) et le bruit disparaît.
    const printedOnly = field === "isbn" ? "" : ` and ${PRINTED_TEXT}`;
    // La bibliographie d'un auteur bénéficie du maximum SRU autorisé ici :
    // moins d'allers-retours réseau, particulièrement sensible sur Android.
    return this.request(`${criterion} ${relation} ${quote(query)}${printedOnly}`, offset, field === "author" ? 100 : 40);
  }

  async getBook(id: string): Promise<BookMetadata> {
    id = id.trim();
    if (!id) throw new Error("BnF id cannot be empty.");
    const [book] = await this.request(`bib.persistentid any ${quote(`ark:/12148/${id}`)}`, 0, 1);
    if (!book) throw new Error("Notice BnF introuvable.");
    return book;
  }
}
