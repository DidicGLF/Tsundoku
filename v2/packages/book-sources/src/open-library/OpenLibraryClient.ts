import type { BookMetadata, BookSearchResult, BookSource } from "../types";
import { getJson } from "../http";
import { mapOpenLibraryDoc,mapOpenLibraryWork,type OpenLibraryDoc,type OpenLibraryWork } from "./mapper";
export class OpenLibraryClient implements BookSource {
 readonly id="open-library" as const;
 constructor(private readonly base="https://openlibrary.org"){}
 async search(query:string):Promise<BookSearchResult[]> {
  query=query.trim();if(!query)return [];
  const p=new URLSearchParams({q:query,limit:"20",fields:"key,title,author_name,first_publish_year,publisher,isbn,number_of_pages_median,language,cover_i,first_sentence"});
  const data=await getJson<{docs?:OpenLibraryDoc[]}>(`${this.base}/search.json?${p}`);return(data.docs??[]).map(mapOpenLibraryDoc);
 }
 async getBook(id:string):Promise<BookMetadata> {
  id=id.trim();if(!id)throw new Error("Open Library work id cannot be empty.");
  const key=id.startsWith("/")?id:`/works/${id.replace(/^works\//,"")}`;
  return mapOpenLibraryWork(await getJson<OpenLibraryWork>(`${this.base}${key}.json`),key);
 }
}
