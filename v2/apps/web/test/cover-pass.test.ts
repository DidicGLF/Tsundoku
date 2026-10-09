import { describe, expect, it } from "vitest";
import { booksNeedingCover } from "../src/services/coverPass";
import type { LibraryBook } from "../src/services/library";

const book = (over: Partial<LibraryBook>): LibraryBook => ({
  id: "x", source: "bnf", sourceId: "x", title: "T", authors: ["A"], status: "TO_READ",
  favorite: false, owned: true, newlyDiscovered: false, addedAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", ...over
});

describe("booksNeedingCover", () => {
  it("keeps books without cover, or with an ISBN and a cover that is not exact to the edition", () => {
    const none = book({ id: "none" });
    const guess = book({ id: "guess", isbn13: "9782266110075", coverUrl: "https://covers.openlibrary.org/b/id/123-L.jpg" });
    const exact = book({ id: "exact", isbn13: "9782266110075", coverUrl: "https://covers.openlibrary.org/b/isbn/9782266110075-L.jpg" });
    const noIsbnCover = book({ id: "noisbn", coverUrl: "https://covers.openlibrary.org/b/id/9-L.jpg" });
    expect(booksNeedingCover([none, guess, exact, noIsbnCover]).map(b => b.id)).toEqual(["none", "guess"]);
  });
});
