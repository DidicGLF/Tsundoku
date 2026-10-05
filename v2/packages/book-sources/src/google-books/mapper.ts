import type { BookMetadata } from "../types";
export interface GoogleBooksVolume {
  id: string;
  volumeInfo?: {
    title?: string; authors?: string[]; description?: string; publishedDate?: string;
    publisher?: string; pageCount?: number; language?: string;
    industryIdentifiers?: Array<{type?: string; identifier?: string}>;
    imageLinks?: {thumbnail?: string; smallThumbnail?: string};
  };
}
export function mapGoogleBook(v: GoogleBooksVolume): BookMetadata {
  const i=v.volumeInfo??{};
  const identifier=(type:string)=>i.industryIdentifiers?.find(x=>x.type===type)?.identifier;
  const match=i.publishedDate?.match(/\b(\d{4})\b/);
  return {source:"google-books",sourceId:v.id,title:i.title?.trim()||"Titre inconnu",
    authors:i.authors??[],publishedYear:match?Number(match[1]):undefined,publishedDate:i.publishedDate,
    publisher:i.publisher,isbn10:identifier("ISBN_10"),isbn13:identifier("ISBN_13"),
    pageCount:i.pageCount,language:i.language,description:i.description,
    coverUrl:i.imageLinks?.thumbnail??i.imageLinks?.smallThumbnail};
}
