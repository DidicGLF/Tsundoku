import type { BookMetadata } from "../types";
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
