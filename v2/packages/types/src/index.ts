export type ReadingStatus = "TO_READ" | "READING" | "READ" | "ABANDONED" | "ON_HOLD";

export interface Book {
  id: string;
  title: string;
  originalTitle?: string;
  description?: string;
  language?: string;
  coverUrl?: string;
  firstPublishedYear?: number;
  openLibraryWorkId?: string;
  googleBooksId?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface UserBook {
  id: string;
  userId: string;
  bookId: string;
  editionId?: string;
  status: ReadingStatus;
  owned: boolean;
  rating?: number;
  review?: string;
  progressType?: "pages" | "chapters" | "percentage" | "minutes";
  progressValue?: number;
  progressTotal?: number;
  favorite: boolean;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}
