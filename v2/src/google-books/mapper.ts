import type { BookMetadata } from "../types";
import type { GoogleBooksVolume } from "./GoogleBooksClient";

function yearFromDate(value?: string): number | undefined {
  const match = value?.match(/\b(\d{4})\b/);
  return match ? Number(match[1]) : undefined;
}

function identifier(volume: GoogleBooksVolume, type: "ISBN_10" | "ISBN_13"): string | undefined {
  return volume.volumeInfo?.industryIdentifiers?.find((item) => item.type === type)?.identifier;
}

export function mapGoogleBook(volume: GoogleBooksVolume): BookMetadata {
  const info = volume.volumeInfo ?? {};
  return {
    source: "google-books",
    sourceId: volume.id,
    title: info.title?.trim() || "Titre inconnu",
    authors: info.authors ?? [],
    publishedYear: yearFromDate(info.publishedDate),
    publishedDate: info.publishedDate,
    publisher: info.publisher,
    isbn10: identifier(volume, "ISBN_10"),
    isbn13: identifier(volume, "ISBN_13"),
    pageCount: info.pageCount,
    language: info.language,
    description: info.description,
    coverUrl: info.imageLinks?.thumbnail ?? info.imageLinks?.smallThumbnail
  };
}
