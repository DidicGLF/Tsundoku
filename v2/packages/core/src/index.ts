import type { ReadingStatus, UserBook } from "@tsundoku/types";

export interface UserBookRepository {
  getById(id: string): Promise<UserBook | null>;
  save(book: UserBook): Promise<void>;
  delete(id: string): Promise<void>;
}

export function createUserBook(input: {
  id: string;
  userId: string;
  bookId: string;
}): UserBook {
  const now = new Date().toISOString();

  return {
    id: input.id,
    userId: input.userId,
    bookId: input.bookId,
    status: "TO_READ",
    owned: false,
    favorite: false,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
}

export async function setReadingStatus(
  repository: UserBookRepository,
  id: string,
  status: ReadingStatus
): Promise<UserBook> {
  const book = await repository.getById(id);
  if (!book) throw new Error(`Livre utilisateur introuvable: ${id}`);

  const updated = {
    ...book,
    status,
    updatedAt: new Date().toISOString(),
  };

  await repository.save(updated);
  return updated;
}
