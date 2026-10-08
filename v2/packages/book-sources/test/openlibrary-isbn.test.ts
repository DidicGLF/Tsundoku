import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenLibraryClient } from "../src/open-library/OpenLibraryClient";
import { mapOpenLibraryEditionData } from "../src/open-library/mapper";

const edition = {
  key: "/books/OL8889745M", title: "Chant 1 de la Belgariade", subtitle: "Le Pion blanc des présages",
  authors: [{ name: "David Eddings" }], number_of_pages: 348, publishers: [{ name: "Pocket" }], publish_date: "January 1, 1990",
  identifiers: { isbn_10: ["2266033751"], isbn_13: ["9782266033756"], openlibrary: ["OL8889745M"] },
  cover: { large: "https://covers.openlibrary.org/b/id/979538-L.jpg" }
};

afterEach(() => vi.unstubAllGlobals());

describe("Open Library ISBN search", () => {
  it("maps the exact edition: its own title, publisher, pages, ISBN and ISBN-based cover", () => {
    expect(mapOpenLibraryEditionData(edition, "9782266033756", "/languages/fre")).toMatchObject({
      source: "open-library", sourceId: "OL8889745M", title: "Chant 1 de la Belgariade : Le Pion blanc des présages",
      authors: ["David Eddings"], publisher: "Pocket", publishedYear: 1990, pageCount: 348, language: "fre",
      isbn13: "9782266033756", isbn10: "2266033751", coverUrl: "https://covers.openlibrary.org/b/isbn/9782266033756-L.jpg"
    });
    expect(mapOpenLibraryEditionData({ ...edition, cover: undefined }, "9782266033756").coverUrl).toBeUndefined();
  });
  it("uses the edition record for an ISBN search, whatever form of the ISBN is typed", async () => {
    const requested: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      const text = decodeURIComponent(String(url));
      if (text.includes("/api/books")) {
        const key = /bibkeys=(ISBN:[0-9X]+)/.exec(text)![1];
        requested.push(key);
        return new Response(JSON.stringify({ [key]: edition }), { status: 200 });
      }
      return new Response(JSON.stringify({ languages: [{ key: "/languages/fre" }] }), { status: 200 });
    });
    const client = new OpenLibraryClient();
    const [fromTen] = await client.search("2-266-03375-1", "fr", 0, "isbn");
    const [fromThirteen] = await client.search("978-2-266-03375-6", "fr", 0, "isbn");
    expect(requested).toEqual(["ISBN:2266033751", "ISBN:9782266033756"]);
    for (const book of [fromTen, fromThirteen]) {
      expect(book).toMatchObject({ title: "Chant 1 de la Belgariade : Le Pion blanc des présages", language: "fre", isbn13: "9782266033756", isbn10: "2266033751" });
    }
  });
  it("falls back to the work record but keeps the ISBN that was searched", async () => {
    vi.stubGlobal("fetch", async (url: string) => {
      if (String(url).includes("/api/books")) return new Response("{}", { status: 200 });
      if (String(url).includes("/isbn/")) return new Response("", { status: 404 });
      return new Response(JSON.stringify({ docs: [{ key: "/works/OL1W", title: "Pawn of Prophecy", isbn: ["9783404201891", "9782266033756"], cover_i: 1000455 }] }), { status: 200 });
    });
    const [book] = await new OpenLibraryClient().search("9782266033756", "fr", 0, "isbn");
    expect(book).toMatchObject({ title: "Pawn of Prophecy", isbn13: "9782266033756", isbn10: "2266033751" });
  });
});
