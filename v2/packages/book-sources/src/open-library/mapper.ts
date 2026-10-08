import type { BookMetadata } from "../types";
import { isbn10To13, isbn13To10 } from "../matching";
export interface OpenLibraryDoc {
  key?:string;title?:string;author_name?:string[];first_publish_year?:number;publisher?:string[];
  isbn?:string[];number_of_pages_median?:number;language?:string[];cover_i?:number;first_sentence?:string|string[];subject?:string[];
}
export interface OpenLibraryWork {key?:string;title?:string;description?:string|{value?:string};first_publish_date?:string;covers?:number[];subjects?:string[];}
const sid=(x?:string)=>(x??"").replace(/^\/works\//,"");
const cover=(x?:number)=>x?`https://covers.openlibrary.org/b/id/${x}-L.jpg`:undefined;

function seriesFromSubjects(subjects?: string[]): string | undefined {
  for (const subject of subjects ?? []) {
    const match = subject.match(/^\[series:\s*(.+?)\]$/i);
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return undefined;
}
export function mapOpenLibraryDoc(d:OpenLibraryDoc):BookMetadata {
 const isbns=(d.isbn??[]).map(x=>x.replace(/[^0-9Xx]/g,"").toUpperCase());
 return {source:"open-library",sourceId:sid(d.key),title:d.title?.trim()||"Titre inconnu",authors:d.author_name??[],
 publishedYear:d.first_publish_year,publisher:d.publisher?.[0],isbn10:isbns.find(x=>x.length===10),
 isbn13:isbns.find(x=>x.length===13),pageCount:d.number_of_pages_median,language:d.language?.[0],
 description:Array.isArray(d.first_sentence)?d.first_sentence[0]:d.first_sentence,coverUrl:cover(d.cover_i),seriesName:seriesFromSubjects(d.subject)};
}
export function mapOpenLibraryWork(w:OpenLibraryWork,key:string):BookMetadata {
 return {source:"open-library",sourceId:sid(w.key??key),title:w.title?.trim()||"Titre inconnu",authors:[],
 publishedDate:w.first_publish_date,description:typeof w.description==="string"?w.description:w.description?.value,coverUrl:cover(w.covers?.[0]),seriesName:seriesFromSubjects(w.subjects)};
}

/** Fiche d'une édition (api/books?jscmd=data) : titre, auteurs, éditeur, pages et jaquette de CETTE édition. */
export interface OpenLibraryEditionData {
  key?: string;
  title?: string;
  subtitle?: string;
  authors?: Array<{ name?: string }>;
  number_of_pages?: number;
  publishers?: Array<{ name?: string }>;
  publish_date?: string;
  identifiers?: { isbn_10?: string[]; isbn_13?: string[]; openlibrary?: string[] };
  cover?: { small?: string; medium?: string; large?: string };
}

export function mapOpenLibraryEditionData(d: OpenLibraryEditionData, isbn: string, languageKey?: string): BookMetadata {
  const searched13 = isbn.length === 13 ? isbn : isbn10To13(isbn);
  const searched10 = isbn.length === 10 ? isbn : isbn13To10(isbn);
  const title = d.title?.trim() || "Titre inconnu";
  const subtitle = d.subtitle?.trim();
  const year = /\b(\d{4})\b/.exec(d.publish_date ?? "")?.[1];
  const olid = d.identifiers?.openlibrary?.[0] ?? (d.key ?? "").replace(/^\/books\//, "");
  return {
    source: "open-library",
    sourceId: olid,
    title: subtitle ? `${title} : ${subtitle}` : title,
    authors: (d.authors ?? []).map(author => author.name?.trim() ?? "").filter(Boolean),
    publishedYear: year ? Number(year) : undefined,
    publisher: d.publishers?.[0]?.name,
    isbn13: searched13 ?? d.identifiers?.isbn_13?.[0],
    isbn10: searched10 ?? d.identifiers?.isbn_10?.[0],
    pageCount: d.number_of_pages,
    language: languageKey?.replace(/^\/languages\//, "") || undefined,
    // Adresse par ISBN : la jaquette de cette édition et non celle d'une autre de la même œuvre.
    coverUrl: d.cover?.large ?? d.cover?.medium ?? d.cover?.small ? `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg` : undefined
  };
}
