import type { BookMetadata } from "../types";

interface SearchDoc {
  key?: string; title?: string; author_name?: string[]; first_publish_year?: number;
  publisher?: string[]; isbn?: string[]; number_of_pages_median?: number;
  language?: string[]; cover_i?: number; first_sentence?: string | string[];
}
interface WorkResponse {
  key?: string; title?: string; description?: string | { value?: string };
  first_publish_date?: string; covers?: number[];
}

function cleanIsbn(value?: string): string | undefined {
  if (!value) return undefined;
  const result = value.replace(/[^0-9Xx]/g, "").toUpperCase();
  return result || undefined;
}

function coverUrl(id?: number): string | undefined {
  return id ? `https://covers.openlibrary.org/b/id/${id}-L.jpg` : undefined;
}

function sourceId(key?: string): string {
  return (key ?? "").replace(/^\/works\//, "");
}

function first(value?: string | string[]): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function mapOpenLibraryDoc(doc: SearchDoc): BookMetadata {
  const isbns = (doc.isbn ?? []).map(cleanIsbn).filter((x): x is string => Boolean(x));
  return {
    source: "open-library",
    sourceId: sourceId(doc.key),
    title: doc.title?.trim() || "Titre inconnu",
    authors: doc.author_name ?? [],
    publishedYear: doc.first_publish_year,
    publisher: doc.publisher?.[0],
    isbn10: isbns.find((x) => x.length === 10),
    isbn13: isbns.find((x) => x.length === 13),
    pageCount: doc.number_of_pages_median,
    language: doc.language?.[0],
    description: first(doc.first_sentence),
    coverUrl: coverUrl(doc.cover_i)
  };
}

export function mapOpenLibraryWork(work: WorkResponse, key: string): BookMetadata {
  const description = typeof work.description === "string"
    ? work.description
    : work.description?.value;
  return {
    source: "open-library",
    sourceId: sourceId(work.key ?? key),
    title: work.title?.trim() || "Titre inconnu",
    authors: [],
    publishedDate: work.first_publish_date,
    description,
    coverUrl: coverUrl(work.covers?.[0])
  };
}
