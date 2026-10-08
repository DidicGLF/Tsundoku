import type { BookMetadata, BookSearchField, BookSearchLanguage, BookSearchResult, BookSource } from "../types";
import { canonicalAuthorDisplay } from "../authors";
import { getText } from "../http";

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

function mapRecord(record: Element): BookSearchResult | null {
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
    language: textValues(record, "language")[0],
    description: textValues(record, "description")[0]
  };
}

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
