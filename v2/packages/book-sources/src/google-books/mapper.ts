import type { BookMetadata } from "../types";

export interface GoogleBooksVolume {
  id: string;
  volumeInfo?: {
    title?: string;
    authors?: string[];
    description?: string;
    publishedDate?: string;
    publisher?: string;
    pageCount?: number;
    language?: string;
    industryIdentifiers?: Array<{ type?: string; identifier?: string }>;
    imageLinks?: {
      extraLarge?: string;
      large?: string;
      medium?: string;
      small?: string;
      thumbnail?: string;
      smallThumbnail?: string;
    };
  };
}

function normalizeCoverUrl(url?: string): string | undefined {
  if (!url) return undefined;

  // Google Books still sometimes returns http:// image URLs. Android WebView
  // blocks mixed/insecure content, so always request the same resource via HTTPS.
  return url.trim().replace(/^http:\/\//i, "https://");
}

export function mapGoogleBook(v: GoogleBooksVolume): BookMetadata {
  const i = v.volumeInfo ?? {};
  const identifier = (type: string) =>
    i.industryIdentifiers?.find(x => x.type === type)?.identifier;
  const match = i.publishedDate?.match(/\b(\d{4})\b/);

  const coverUrl = normalizeCoverUrl(
    i.imageLinks?.extraLarge ??
      i.imageLinks?.large ??
      i.imageLinks?.medium ??
      i.imageLinks?.small ??
      i.imageLinks?.thumbnail ??
      i.imageLinks?.smallThumbnail
  );

  return {
    source: "google-books",
    sourceId: v.id,
    title: i.title?.trim() || "Titre inconnu",
    authors: i.authors ?? [],
    publishedYear: match ? Number(match[1]) : undefined,
    publishedDate: i.publishedDate,
    publisher: i.publisher,
    isbn10: identifier("ISBN_10"),
    isbn13: identifier("ISBN_13"),
    pageCount: i.pageCount,
    language: i.language,
    description: i.description,
    coverUrl
  };
}
