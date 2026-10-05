export interface BibliographicAuthor {
  id: string;
  name: string;
  normalizedName: string;
  openLibraryAuthorId?: string;
}

export interface BibliographicBook {
  id: string;
  title: string;
  originalTitle?: string;
  description?: string;
  language?: string;
  coverUrl?: string;
  firstPublishedYear?: number;
  openLibraryWorkId?: string;
  googleBooksId?: string;
  authors: BibliographicAuthor[];
}

export interface BibliographicEdition {
  id: string;
  bookId: string;
  title?: string;
  publisher?: string;
  publishedYear?: number;
  isbn10?: string;
  isbn13?: string;
  pageCount?: number;
  language?: string;
  coverUrl?: string;
  openLibraryEditionId?: string;
  googleBooksId?: string;
}
