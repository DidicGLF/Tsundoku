import { describe, expect, it } from "vitest";
import {
  authorInitial, authorStats, booksOfAuthor, filterAuthorBooks, filterLibrary, findNewWorks, groupByAuthor,
  libraryFilterCounts, plural, progressPercent, sortLibrary
} from "../src/lib/library-view";
import type { LibraryBook } from "../src/services/library";

let n = 0;
const book = (over: Partial<LibraryBook> = {}): LibraryBook => ({
  id: `b${++n}`, source: "open-library", sourceId: `s${n}`, title: `Livre ${n}`, authors: ["Frank Herbert"],
  status: "TO_READ", favorite: false, owned: true, newlyDiscovered: false,
  addedAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", ...over
});

describe("filterLibrary", () => {
  const library = [
    book({ title: "Dune", owned: true, status: "READ", favorite: true }),
    book({ title: "Le Messie de Dune", owned: false }),
    book({ title: "Hypérion", authors: ["Dan Simmons"], isbn13: "9782070415236", status: "READING" })
  ];
  it("filters by ownership, status and favorites", () => {
    expect(filterLibrary(library, "MISSING", "").map(b => b.title)).toEqual(["Le Messie de Dune"]);
    expect(filterLibrary(library, "OWNED", "")).toHaveLength(2);
    expect(filterLibrary(library, "READING", "")).toHaveLength(1);
    expect(filterLibrary(library, "FAVORITES", "")).toHaveLength(1);
  });
  it("searches title, author and ISBN ignoring case", () => {
    expect(filterLibrary(library, "ALL", "DUNE")).toHaveLength(2);
    expect(filterLibrary(library, "ALL", "simmons")).toHaveLength(1);
    expect(filterLibrary(library, "ALL", "9782070415236")).toHaveLength(1);
  });
  it("combines filter and query", () => {
    expect(filterLibrary(library, "OWNED", "dune").map(b => b.title)).toEqual(["Dune"]);
  });
  it("counts per filter", () => {
    const counts = Object.fromEntries(libraryFilterCounts(library).map(([k, , c]) => [k, c]));
    expect(counts).toMatchObject({ ALL: 3, MISSING: 1, OWNED: 2, READ: 1, READING: 1, FAVORITES: 1 });
  });
});

describe("sortLibrary", () => {
  it("sorts by recency, title and progress (unknown last)", () => {
    const a = book({ title: "B", updatedAt: "2026-03-01T00:00:00Z", progressValue: 10, progressTotal: 100 });
    const b = book({ title: "A", updatedAt: "2026-01-01T00:00:00Z", progressValue: 50, progressTotal: 100 });
    const c = book({ title: "C", updatedAt: "2026-02-01T00:00:00Z" });
    expect(sortLibrary([a, b, c], "RECENT").map(x => x.title)).toEqual(["B", "C", "A"]);
    expect(sortLibrary([a, b, c], "TITLE").map(x => x.title)).toEqual(["A", "B", "C"]);
    expect(sortLibrary([a, b, c], "PROGRESS").map(x => x.title)).toEqual(["A", "B", "C"]);
    expect(progressPercent(c)).toBe(-1);
  });
});

describe("groupByAuthor", () => {
  it("merges BnF and plain spellings of an author and orders groups by surname", () => {
    const groups = groupByAuthor([
      book({ title: "Hypérion", authors: ["Simmons, Dan (1948-....). Auteur du texte"] }),
      book({ title: "Dune", authors: ["Frank Herbert"], owned: false }),
      book({ title: "Ilium", authors: ["Dan Simmons"] })
    ], "TITLE");
    expect(groups.map(g => g.author)).toEqual(["Frank Herbert", "Dan Simmons"]);
    expect(groups[1].books.map(b => b.title)).toEqual(["Hypérion", "Ilium"]);
    expect(groups[0]).toMatchObject({ initial: "H", ownedCount: 0 });
    expect(groups[1]).toMatchObject({ initial: "S", ownedCount: 2 });
  });
  it("puts non-latin authors under #", () => {
    expect(authorInitial("宮崎駿")).toBe("#");
    expect(groupByAuthor([book({ authors: ["宮崎駿"] }), book({ authors: ["尾田栄一郎"] })], "TITLE")).toHaveLength(2);
  });
});

describe("author bibliography", () => {
  const library = [
    book({ authors: ["Frank Herbert"], owned: true, status: "READ" }),
    book({ authors: ["Herbert, Frank (1920-1986). Auteur du texte"], owned: false, newlyDiscovered: true }),
    book({ authors: ["Dan Simmons"] })
  ];
  it("selects an author's books whatever the spelling", () => {
    expect(booksOfAuthor(library, "frank herbert")).toHaveLength(2);
    expect(booksOfAuthor(library, null)).toEqual([]);
  });
  it("computes stats", () => {
    expect(authorStats(booksOfAuthor(library, "frank herbert"))).toEqual({ total: 2, owned: 1, read: 1, missing: 1, unread: 1, newlyDiscovered: 1 });
  });
  it("filters and sorts: missing first, then title; recent publications first", () => {
    const books = [book({ title: "B", owned: true, publishedYear: 1970 }), book({ title: "A", owned: false, publishedYear: 1965 }), book({ title: "C", owned: true, publishedYear: 1980 })];
    expect(filterAuthorBooks(books, "ALL", "MISSING").map(b => b.title)).toEqual(["A", "B", "C"]);
    expect(filterAuthorBooks(books, "ALL", "DATE").map(b => b.title)).toEqual(["C", "B", "A"]);
    expect(filterAuthorBooks(books, "MISSING", "TITLE").map(b => b.title)).toEqual(["A"]);
    expect(filterAuthorBooks(books, "TO_READ", "TITLE")).toHaveLength(3);
  });
  it("detects works missing locally, even with another ISBN or spelling", () => {
    const local = [book({ title: "Dune", authors: ["Frank Herbert"], isbn13: "9780441172719" })];
    const remote = [
      { source: "bnf" as const, sourceId: "1", title: "Dune", authors: ["Herbert, Frank (1920-1986)"], isbn13: "9782266320481" },
      { source: "bnf" as const, sourceId: "2", title: "L'Empereur-Dieu de Dune", authors: ["Frank Herbert"] }
    ];
    expect(findNewWorks(remote, local).map(b => b.title)).toEqual(["L'Empereur-Dieu de Dune"]);
  });
});

describe("libraryStateOf", () => {
  it("tells absent, tracked and owned results apart", async () => {
    const { createWorkIndex, libraryStateOf } = await import("../src/lib/library-view");
    const mkBook = (title: string, owned: boolean, isbn13: string, sourceId: string) =>
      ({ id: sourceId, source: "bnf", sourceId, title, authors: ["David Eddings"], isbn13, owned }) as never;
    const index = createWorkIndex([mkBook("La Belgariade", false, "9782266000002", "ark1"), mkBook("Polgara la sorcière", true, "9782266000003", "ark2")]);
    const result = (title: string, isbn13: string, sourceId: string) => ({ source: "open-library", sourceId, title, authors: ["David Eddings"], isbn13 }) as never;
    expect(libraryStateOf(result("La Belgariade", "9782266111111", "OL1"), index)).toBe("tracked");
    expect(libraryStateOf(result("x", "9782266000003", "OL2"), index)).toBe("owned");
    expect(libraryStateOf(result("Les Dômes de feu", "9782266222222", "OL3"), index)).toBe("none");
    expect(libraryStateOf({ source: "bnf", sourceId: "ark1", title: "Autre titre", authors: [] } as never, index)).toBe("tracked");
  });
});

describe("plural", () => {
  it("only pluralizes above 1", () => {
    expect(plural(0, "livre")).toBe("livre");
    expect(plural(1, "livre")).toBe("livre");
    expect(plural(2, "livre")).toBe("livres");
    expect(plural(2, "sera", "seront")).toBe("seront");
  });
});

describe("attributeOrphans", () => {
  it("gives an author to authorless notices and leaves the others alone", async () => {
    const { attributeOrphans } = await import("../src/lib/library-view");
    const result = attributeOrphans([{ authors: [] }, { authors: ["  "] }, { authors: ["Robert Silverberg"] }], "Isaac Asimov");
    expect(result.map(book => book.authors)).toEqual([["Isaac Asimov"], ["Isaac Asimov"], ["Robert Silverberg"]]);
  });
});

describe("book page helpers", () => {
  it("turns a percentage into pages, keeping a known total and falling back to 100", async () => {
    const { progressUpdateFor, pageReached, readPercent, ratingLabels, bookDatesLine } = await import("../src/lib/library-view");
    expect(progressUpdateFor({ pageCount: 928 }, 42)).toEqual({ progressValue: 390, progressTotal: 928 });
    expect(progressUpdateFor({ progressTotal: 300, pageCount: 928 }, 50)).toEqual({ progressValue: 150, progressTotal: 300 });
    expect(progressUpdateFor({}, 42)).toEqual({ progressValue: 42, progressTotal: 100 });
    expect(progressUpdateFor({}, 140)).toEqual({ progressValue: 100, progressTotal: 100 });
    expect(pageReached({ pageCount: 928 }, 42)).toBe(390);
    expect(pageReached({}, 42)).toBeUndefined();
    expect(readPercent({ progressValue: 390, progressTotal: 928 } as never)).toBe(42);
    expect(readPercent({} as never)).toBe(0);
    expect(ratingLabels[0]).toBe("Pas encore noté");
    expect(ratingLabels).toHaveLength(6);
    const base = { addedAt: "2026-09-12T10:00:00Z", startedAt: "2026-10-03T10:00:00Z", finishedAt: "2026-10-21T10:00:00Z" };
    expect(bookDatesLine({ ...base, status: "READ" })).toBe("Commencé le 3 octobre · terminé le 21 octobre · 18 jours");
    expect(bookDatesLine({ ...base, status: "READING" }, new Date("2026-10-08T10:00:00Z"))).toBe("Commencé le 3 octobre · 5 jours de lecture");
    expect(bookDatesLine({ ...base, status: "TO_READ" })).toBe("Dans ma pile depuis le 12 septembre");
  });
});

describe("getBookLanguageName", () => {
  it("names known languages in French and stays empty when unknown", async () => {
    const { getBookLanguageName } = await import("../src/services/language");
    expect(getBookLanguageName({ language: "fre" } as never)).toBe("Français");
    expect(getBookLanguageName({ language: "eng" } as never)).toBe("Anglais");
    expect(getBookLanguageName({} as never)).toBe("");
  });
});

describe("groupBySeries and initialsOf", () => {
  const book = (title: string, seriesName?: string, seriesVolume?: number) => ({ title, seriesName, seriesVolume }) as never;
  it("groups by series in volume order, standalone last, flat when no series exists", async () => {
    const { groupBySeries } = await import("../src/lib/library-view");
    const groups = groupBySeries([book("Hors 1"), book("Messie", "Dune", 2), book("Dune", "dune", 1), book("Autre", "Fondation", 1), book("Hors 2")]);
    expect(groups.map(g => g.name)).toEqual(["Dune", "Fondation", undefined]);
    expect(groups[0].books.map(b => (b as { title: string }).title)).toEqual(["Dune", "Messie"]);
    expect(groups[2].books).toHaveLength(2);
    const flat = groupBySeries([book("A"), book("B")]);
    expect(flat).toHaveLength(1);
    expect(flat[0].name).toBeUndefined();
  });
  it("builds initials", async () => {
    const { initialsOf } = await import("../src/lib/library-view");
    expect(initialsOf("Frank Herbert")).toBe("FH");
    expect(initialsOf("Jean-Claude Van Damme")).toBe("JD");
    expect(initialsOf("Makyo")).toBe("MA");
    expect(initialsOf("")).toBe("?");
  });
});

describe("titleInitial", () => {
  it("ignores leading articles and elisions", async () => {
    const { titleInitial } = await import("../src/components/Cover");
    expect(titleInitial("Le Messie de Dune")).toBe("M");
    expect(titleInitial("L'Empereur-Dieu de Dune")).toBe("E");
    expect(titleInitial("Les Yeux d'Heisenberg")).toBe("Y");
    expect(titleInitial("Dune")).toBe("D");
    expect(titleInitial("The Left Hand of Darkness")).toBe("L");
    expect(titleInitial("")).toBe("?");
  });
});

describe("finding the library work of a search result", () => {
  const local = (title: string, authors: string[], isbn13?: string, extra: object = {}) =>
    ({ id: title, source: "bnf", sourceId: title, title, authors, isbn13, owned: false, ...extra }) as never;
  const result = (title: string, authors: string[], isbn13?: string) => ({ source: "open-library", sourceId: "ol:" + title, title, authors, isbn13 }) as never;

  it("recognises another edition of a work imported from the author's bibliography", async () => {
    const { createWorkIndex, findLocalWork } = await import("../src/lib/library-view");
    const library = [
      local("Le pion blanc des présages / David Eddings ; [trad. par Dominique Haas]", ["David Eddings"], "9782266000001"),
      local("La Belgariade", ["David Eddings"], "9782266000002"),
      local("Polgara la sorcière", ["David Eddings", "Leigh Eddings"], "9782266000003")
    ];
    const index = createWorkIndex(library);
    // ISBN différent, titre de catalogue différent
    expect(findLocalWork(result("Le Pion blanc des présages", ["David Eddings"], "9782266999999"), index)).toBe(library[0]);
    // même ISBN, titre sans rapport
    expect(findLocalWork(result("Autre titre", ["Quelqu'un"], "9782266000002"), index)).toBe(library[1]);
    // co-auteurs : le premier auteur diffère mais un auteur est en commun
    expect(findLocalWork(result("Polgara la sorcière", ["Leigh Eddings", "David Eddings"], "9782266777777"), index)).toBe(library[2]);
    // même titre, autre auteur : ce n'est pas la même œuvre
    expect(findLocalWork(result("La Belgariade", ["Quelqu'un d'autre"], "9782266888888"), index)).toBeUndefined();
    // titre inconnu
    expect(findLocalWork(result("Les Dômes de feu", ["David Eddings"], "9782266555555"), index)).toBeUndefined();
  });
});

describe("planDuplicateMerges", () => {
  const lb = (id: string, title: string, authors: string[], isbn13: string, addedAt: string, extra: object = {}) =>
    ({ id, source: "bnf", sourceId: id, title, authors, isbn13, addedAt, owned: false, favorite: false, status: "TO_READ", ...extra }) as never;
  it("keeps the oldest entry and carries owned/status/rating over from its duplicates", async () => {
    const { planDuplicateMerges } = await import("../src/lib/library-view");
    const merges = planDuplicateMerges([
      lb("a", "Le pion blanc des présages / David Eddings", ["David Eddings"], "9782266000001", "2026-10-01T10:00:00Z"),
      lb("b", "Le Pion blanc des présages", ["David Eddings"], "9782266999999", "2026-10-05T10:00:00Z", { owned: true, status: "READ", rating: 4, favorite: true }),
      lb("c", "Polgara la sorcière", ["David Eddings", "Leigh Eddings"], "9782266000003", "2026-10-02T10:00:00Z"),
      lb("d", "La Belgariade", ["David Eddings"], "9782266000002", "2026-10-03T10:00:00Z")
    ]);
    expect(merges).toEqual([{ keepId: "a", removeIds: ["b"], changes: { owned: true, favorite: true, status: "READ", rating: 4 } }]);
  });
  it("does nothing when there are no duplicates", async () => {
    const { planDuplicateMerges } = await import("../src/lib/library-view");
    expect(planDuplicateMerges([lb("a", "Dune", ["Frank Herbert"], "1", "2026-10-01T10:00:00Z"), lb("b", "Dune", ["Autre"], "2", "2026-10-02T10:00:00Z")])).toEqual([]);
  });
});

describe("friendlySearchError", () => {
  it("explains quota and availability errors in French", async () => {
    const { friendlySearchError } = await import("../src/services/bookSearch");
    expect(friendlySearchError(new Error("HTTP 429 while requesting www.googleapis.com"), false)).toContain("ajoute une clé gratuite");
    expect(friendlySearchError(new Error("HTTP 429 while requesting www.googleapis.com"), true)).toContain("quota du jour");
    expect(friendlySearchError(new Error("HTTP 429 while requesting openlibrary.org"), true)).toContain("Réessaie dans quelques minutes");
    expect(friendlySearchError(new Error("HTTP 503 while requesting catalogue.bnf.fr"), false)).toBe("BnF est momentanément indisponible (erreur 503). Réessaie dans un instant ou change de source.");
    expect(friendlySearchError(new Error("Délai dépassé en interrogeant openlibrary.org"), false)).toBe("Délai dépassé en interrogeant openlibrary.org");
  });
});

describe("nextQuotaReset", () => {
  it("returns the next midnight in Los Angeles", async () => {
    const { nextQuotaReset } = await import("../src/services/googleQuota");
    // 2026-10-08 16:00 UTC = 09:00 PDT → minuit PDT suivant = 2026-10-09 07:00 UTC
    expect(new Date(nextQuotaReset(Date.parse("2026-10-08T16:00:00Z"))).toISOString()).toBe("2026-10-09T07:00:00.000Z");
    // une seconde après minuit PDT : le prochain minuit est 24 h moins une seconde plus tard
    expect(new Date(nextQuotaReset(Date.parse("2026-10-08T07:00:01Z"))).toISOString()).toBe("2026-10-09T07:00:00.000Z");
  });
});
