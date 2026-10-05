import type {BookSearchResult} from "@tsundoku/book-sources";
export interface LocalLibraryBook extends BookSearchResult{localId:string;addedAt:string;status:"TO_READ"|"READING"|"READ"}
const KEY="tsundoku.v2.prototype.library";
export function loadPrototypeLibrary():LocalLibraryBook[]{try{return JSON.parse(localStorage.getItem(KEY)||"[]")}catch{return []}}
export function addPrototypeBook(book:BookSearchResult):LocalLibraryBook[]{
 const list=loadPrototypeLibrary();
 if(list.some(x=>(book.isbn13&&x.isbn13===book.isbn13)||(book.isbn10&&x.isbn10===book.isbn10)||(x.source===book.source&&x.sourceId===book.sourceId)))return list;
 const next=[{...book,localId:crypto.randomUUID(),addedAt:new Date().toISOString(),status:"TO_READ" as const},...list];
 localStorage.setItem(KEY,JSON.stringify(next));return next;
}