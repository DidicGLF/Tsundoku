import {GoogleBooksClient,OpenLibraryClient,type BookSearchResult} from "@tsundoku/book-sources";
import {WebCredentialStore} from "@tsundoku/credentials";
export type SearchProvider="all"|"open-library"|"google-books";
const openLibrary=new OpenLibraryClient(),googleBooks=new GoogleBooksClient(new WebCredentialStore());
export async function searchBooks(q:string,p:SearchProvider):Promise<BookSearchResult[]>{
 q=q.trim();if(!q)return [];
 if(p==="open-library")return openLibrary.search(q);if(p==="google-books")return googleBooks.search(q);
 const s=await Promise.allSettled([openLibrary.search(q),googleBooks.search(q)]);
 const all=s.flatMap(x=>x.status==="fulfilled"?x.value:[]);
 if(!all.length&&s.every(x=>x.status==="rejected"))throw new Error("Aucune source de livres n'est disponible.");
 const m=new Map<string,BookSearchResult>();for(const b of all){const k=b.isbn13||b.isbn10||`${b.title.toLowerCase()}::${b.authors[0]?.toLowerCase()??""}`;if(!m.has(k))m.set(k,b);}return[...m.values()];
}
