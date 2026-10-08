import { describe, expect, it } from "vitest";
import { canonicalIsbn, cleanCatalogTitle, cleanIsbn, collapseToWorks, isConfidentCoverMatch, isbn10To13, isSameEdition, isSameWork, mergeSearchResults, normalizeText } from "../src/matching";
import type { BookSearchResult } from "../src/types";

const book = (over: Partial<BookSearchResult> = {}): BookSearchResult => ({
  source: "open-library", sourceId: "x", title: "La Horde du Contrevent", authors: ["Alain Damasio"], ...over
});

describe("normalizeText", () => {
  it("strips accents, case and punctuation", () => {
    expect(normalizeText("  L'Été — Œuvres, Tome 1 !")).toBe("l ete œuvres tome 1");
  });
});

describe("ISBN helpers", () => {
  it("cleans separators and rejects wrong lengths", () => {
    expect(cleanIsbn("978-2-07-036002-4")).toBe("9782070360024");
    expect(cleanIsbn("2-07-036002-1")).toBe("2070360021");
    expect(cleanIsbn("12345")).toBeUndefined();
    expect(cleanIsbn(undefined)).toBeUndefined();
  });
  it("converts ISBN-10 to ISBN-13 (including X check digit)", () => {
    expect(isbn10To13("0306406152")).toBe("9780306406157");
    expect(isbn10To13("080442957X")).toBe("9780804429573");
    expect(isbn10To13("abc")).toBeUndefined();
  });
  it("prefers ISBN-13 and falls back to a converted ISBN-10", () => {
    expect(canonicalIsbn({ isbn13: "9780306406157", isbn10: "000" })).toBe("9780306406157");
    expect(canonicalIsbn({ isbn10: "0-306-40615-2" })).toBe("9780306406157");
    expect(canonicalIsbn({})).toBeUndefined();
  });
});

describe("mergeSearchResults", () => {
  it("merges an ISBN-10 and an ISBN-13 of the same book and fills gaps", () => {
    const merged = mergeSearchResults([
      book({ isbn10: "0306406152", publisher: "A" }),
      book({ isbn13: "9780306406157", coverUrl: "c.jpg", pageCount: 300 })
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ coverUrl: "c.jpg", publisher: "A", pageCount: 300, isbn10: "0306406152" });
  });
  it("keeps different ISBNs apart", () => {
    expect(mergeSearchResults([book({ isbn13: "9780306406157" }), book({ isbn13: "9782070360024" })])).toHaveLength(2);
  });
  it("falls back to title + author without ISBN", () => {
    expect(mergeSearchResults([book(), book({ title: "la horde du contrevent" })])).toHaveLength(1);
    expect(mergeSearchResults([book(), book({ authors: ["Autre Auteur"] })])).toHaveLength(2);
  });
});

describe("isSameEdition vs isSameWork", () => {
  const a = { title: "Dune", authors: ["Frank Herbert"], isbn13: "9780306406157" };
  const b = { title: "Dune", authors: ["Herbert, Frank (1920-1986). Auteur du texte"], isbn13: "9782070360024" };
  it("treats different ISBNs as different editions but the same work", () => {
    expect(isSameEdition(a, b)).toBe(false);
    expect(isSameWork(a, b)).toBe(true);
  });
  it("matches on a shared ISBN regardless of formatting", () => {
    expect(isSameWork({ ...a, title: "x" }, { title: "y", authors: [], isbn13: "978-0-306-40615-7" })).toBe(true);
  });
  it("does not match different titles", () => {
    expect(isSameWork(a, { ...a, title: "Dune Messiah", isbn13: undefined })).toBe(false);
  });
  it("tolerates a missing author on one side", () => {
    expect(isSameWork({ title: "Dune", authors: [] }, a)).toBe(true);
  });
});

describe("collapseToWorks", () => {
  it("merges editions across author spellings and sorts newest first", () => {
    const result = collapseToWorks([
      book({ title: "Dune", authors: ["Herbert, Frank (1920-1986). Auteur du texte"], publishedYear: 1970 }),
      book({ title: "Dune", authors: ["Frank Herbert"], coverUrl: "c.jpg" }),
      book({ title: "Children of Dune", authors: ["Frank Herbert"], publishedYear: 1976 })
    ]);
    expect(result.map(r => r.title)).toEqual(["Children of Dune", "Dune"]);
    expect(result[1]).toMatchObject({ coverUrl: "c.jpg", publishedYear: 1970 });
  });
});

describe("non-latin scripts", () => {
  it("keeps titles and authors distinct instead of normalizing them to an empty string", () => {
    expect(normalizeText("千と千尋の神隠し")).toBe("千と千尋の神隠し");
    const result = collapseToWorks([
      book({ title: "千と千尋の神隠し", authors: ["宮崎駿"] }),
      book({ title: "風の谷のナウシカ", authors: ["宮崎駿"] })
    ]);
    expect(result).toHaveLength(2);
  });
});

describe("cleanCatalogTitle", () => {
  it("keeps the main title of noisy catalogue records", () => {
    expect(cleanCatalogTitle("Dune ; (suivi de) Le Messie de Dune : roman /")).toBe("Dune");
    expect(cleanCatalogTitle("Avant Dune / Brian Herbert et Kevin J. Anderson")).toBe("Avant Dune");
    expect(cleanCatalogTitle("Dune (Éd. revue et corrigée)")).toBe("Dune");
    expect(cleanCatalogTitle("Le Seigneur des anneaux. 1, La Communauté de l'anneau")).toBe("Le Seigneur des anneaux. 1, La Communauté de l'anneau");
    expect(cleanCatalogTitle("  ")).toBe("");
  });
});

describe("isConfidentCoverMatch", () => {
  const wanted = { title: "Après Dune / Brian Herbert", authors: ["Herbert, Brian (1947-....). Auteur du texte"] };
  it("accepts the same title by the same author, whatever the spelling", () => {
    expect(isConfidentCoverMatch(wanted, { title: "Après Dune", author_name: ["Brian Herbert", "Kevin J. Anderson"] })).toBe(true);
  });
  it("rejects a fuzzy hit from another book or another author", () => {
    expect(isConfidentCoverMatch(wanted, { title: "Les trois Mousquetaires", author_name: ["Alexandre Dumas"] })).toBe(false);
    expect(isConfidentCoverMatch(wanted, { title: "Après Dune", author_name: ["Frank Smith"] })).toBe(false);
    expect(isConfidentCoverMatch(wanted, { title: "Avant Dune", author_name: ["Brian Herbert"] })).toBe(false);
  });
  it("accepts a title match when the wanted book has no author", () => {
    expect(isConfidentCoverMatch({ title: "Dune", authors: [] }, { title: "Dune", author_name: ["Frank Herbert"] })).toBe(true);
  });
});
