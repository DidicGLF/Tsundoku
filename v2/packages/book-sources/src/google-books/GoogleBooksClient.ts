import type { BookMetadata, BookSearchResult, BookSource, GoogleBooksApiKeyProvider } from "../types";
import { getJson } from "../http";
import { mapGoogleBook, type GoogleBooksVolume } from "./mapper";
interface Response { items?: GoogleBooksVolume[]; }
export class GoogleBooksClient implements BookSource {
  readonly id="google-books" as const;
  constructor(private readonly keys:GoogleBooksApiKeyProvider,private readonly base="https://www.googleapis.com/books/v1"){}
  private async params(values:Record<string,string>) {
    const p=new URLSearchParams(values); const key=await this.keys.getGoogleBooksApiKey(); if(key)p.set("key",key); return p;
  }
  async search(query:string):Promise<BookSearchResult[]> {
    query=query.trim(); if(!query)return [];
    const p=await this.params({q:query,maxResults:"20",printType:"books"});
    const data=await getJson<Response>(`${this.base}/volumes?${p}`); return (data.items??[]).map(mapGoogleBook);
  }
  async getBook(id:string):Promise<BookMetadata> {
    id=id.trim(); if(!id)throw new Error("Google Books volume id cannot be empty.");
    const p=await this.params({}); const suffix=p.toString()?`?${p}`:"";
    return mapGoogleBook(await getJson<GoogleBooksVolume>(`${this.base}/volumes/${encodeURIComponent(id)}${suffix}`));
  }
}
