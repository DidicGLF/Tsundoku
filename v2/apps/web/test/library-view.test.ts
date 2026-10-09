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

describe("sortLibrary COVER", () => {
  it("puts books with a cover first, most recent first inside each part", () => {
    const old = book({ title: "Ancien", coverUrl: "https://x/a.jpg", updatedAt: "2026-01-01T00:00:00Z" });
    const recent = book({ title: "Récent", coverUrl: "https://x/b.jpg", updatedAt: "2026-03-01T00:00:00Z" });
    const bare = book({ title: "Sans", updatedAt: "2026-04-01T00:00:00Z" });
    expect(sortLibrary([bare, old, recent], "COVER").map(x => x.title)).toEqual(["Récent", "Ancien", "Sans"]);
    const [group] = groupByAuthor([bare, old, recent], "COVER");
    expect(group.books.map(x => x.title)).toEqual(["Récent", "Ancien", "Sans"]);
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
    expect(merges).toMatchObject([{ keepId: "a", removeIds: ["b"], changes: { owned: true, favorite: true, status: "READ", rating: 4 } }]);
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

describe("author info", () => {
  it("accepts a matching writer article and rejects homonyms and disambiguation pages", async () => {
    const { isAuthorSummary } = await import("../src/lib/author-info");
    const writer = { type: "standard", title: "David Eddings", description: "écrivain américain", extract: "David Carroll Eddings, né le 7 juillet 1931 à Spokane, est un écrivain américain de fantasy." };
    expect(isAuthorSummary(writer, "David Eddings")).toBe(true);
    expect(isAuthorSummary({ ...writer, type: "disambiguation" }, "David Eddings")).toBe(false);
    expect(isAuthorSummary({ type: "standard", title: "David Eddings", description: "footballeur anglais", extract: "David Eddings est un footballeur." }, "David Eddings")).toBe(false);
    expect(isAuthorSummary({ type: "standard", title: "Autre", description: "écrivain français", extract: "Un écrivain." }, "David Eddings")).toBe(false);
    expect(isAuthorSummary(null, "David Eddings")).toBe(false);
  });
  it("builds the info from Wikipedia, takes missing years from Open Library, and falls back to Open Library", async () => {
    const { buildAuthorInfo, formatLifespan, yearsFromDescription } = await import("../src/lib/author-info");
    expect(yearsFromDescription("écrivain russe naturalisé américain (1920–1992)")).toEqual({ birthYear: 1920, deathYear: 1992 });
    const wikipedia = { description: "écrivain américain", extract: "Résumé.", thumbnail: { source: "https://upload.wikimedia.org/x.jpg" }, content_urls: { desktop: { page: "https://fr.wikipedia.org/wiki/David_Eddings" } } };
    const info = buildAuthorInfo(wikipedia, { birth_date: "1931", death_date: "2009", work_count: 253 });
    expect(info).toMatchObject({ description: "écrivain américain", bio: "Résumé.", birthYear: 1931, deathYear: 2009, workCount: 253, source: "wikipedia" });
    expect(formatLifespan(info!)).toBe("1931–2009");
    const withYears = buildAuthorInfo({ description: "écrivain russe naturalisé américain (1920–1992)", extract: "x" }, null);
    expect(withYears).toMatchObject({ description: "écrivain russe naturalisé américain", birthYear: 1920, deathYear: 1992 });
    const fallback = buildAuthorInfo(null, { birth_date: "2 January 1920", bio: { value: "English bio" }, photos: [-1, 7425151], work_count: 1456 });
    expect(fallback).toMatchObject({ bio: "English bio", photoUrl: "https://covers.openlibrary.org/a/id/7425151-M.jpg", birthYear: 1920, source: "open-library" });
    expect(buildAuthorInfo(null, { name: "Inconnu" })).toBeNull();
    expect(buildAuthorInfo(null, { name: "Jean Martin", work_count: 4 })).toBeNull();
    const fromText = buildAuthorInfo({ description: "écrivain et journaliste français", extract: "Nicolas Beuglet, né le 28 mai 1974, est un écrivain." }, { work_count: 8 });
    expect(fromText).toMatchObject({ birthYear: 1974, deathYear: undefined });
    const died = buildAuthorInfo({ description: "écrivain américain", extract: "David Eddings, né le 7 juillet 1931 à Spokane et mort le 2 juin 2009 à Carson City, est un écrivain." }, null);
    expect(died).toMatchObject({ birthYear: 1931, deathYear: 2009 });
    expect(formatLifespan({ birthYear: 1974 })).toBe("né en 1974");
    expect(formatLifespan({})).toBe("");
  });
});

describe("completeAuthorNames", () => {
  const lib = (...authors: string[][]) => authors.map(list => ({ authors: list }));
  it("completes a partial name with the library's fuller one", async () => {
    const { completeAuthorNames } = await import("../src/lib/library-view");
    const library = lib(...Array.from({ length: 6 }, () => ["David Eddings"]), ["Leigh Eddings"]);
    expect(completeAuthorNames(["Eddings"], library)).toEqual(["David Eddings"]);
    expect(completeAuthorNames(["David Eddings"], library)).toEqual(["David Eddings"]);
    expect(completeAuthorNames(["Leigh Eddings"], library)).toEqual(["Leigh Eddings"]);
    expect(completeAuthorNames(["Isaac Asimov"], library)).toEqual(["Isaac Asimov"]);
    // deux candidats à égalité : on ne devine pas
    expect(completeAuthorNames(["Eddings"], lib(["David Eddings"], ["Leigh Eddings"]))).toEqual(["Eddings"]);
  });
  it("lets a surname-only result find its work and merges the existing split", async () => {
    const { createWorkIndex, findLocalWork, planDuplicateMerges } = await import("../src/lib/library-view");
    const book = (id: string, title: string, authors: string[], isbn13: string, addedAt: string, extra: object = {}) =>
      ({ id, source: "bnf", sourceId: id, title, authors, isbn13, addedAt, owned: false, favorite: false, status: "TO_READ", ...extra }) as never;
    const bibliography = book("a", "Le chevalier de rubis / David Eddings ; trad.", ["David Eddings"], "9782266064668", "2026-10-01T10:00:00Z");
    const result = { source: "manual", sourceId: "m", title: "Le chevalier de rubis", authors: ["Eddings"], isbn13: "9782266142021" } as never;
    expect(findLocalWork(result, createWorkIndex([bibliography]))).toBe(bibliography);
    const split = book("b", "Le chevalier de rubis", ["Eddings"], "9782266142021", "2026-10-05T10:00:00Z", { owned: true });
    expect(planDuplicateMerges([bibliography, split])).toMatchObject([{ keepId: "a", removeIds: ["b"], changes: { owned: true }, edition: { isbn13: "9782266142021" } }]);
  });
});

describe("owned edition", () => {
  const lb = (id: string, title: string, authors: string[], isbn13: string, addedAt: string, extra: object = {}) =>
    ({ id, source: "bnf", sourceId: id, title, authors, isbn13, addedAt, owned: false, favorite: false, status: "TO_READ", ...extra }) as never;
  it("a merge carries the owned edition (ISBN, cover, publisher) over to the kept entry", async () => {
    const { planDuplicateMerges } = await import("../src/lib/library-view");
    const merges = planDuplicateMerges([
      lb("a", "Le trône de diamant / David Eddings ; [trad.]", ["David Eddings"], "9782298006094", "2026-10-01T10:00:00Z", { coverUrl: "autre-edition.jpg" }),
      lb("b", "Le trone de diamant la trilogie des joyaux I", ["Eddings"], "9782266110075", "2026-10-05T10:00:00Z", { owned: true, coverUrl: "ma-couverture.jpg", publisher: "Pocket", isbn10: "2266110071" })
    ]);
    expect(merges[0].edition).toMatchObject({ isbn13: "9782266110075", isbn10: "2266110071", publisher: "Pocket", coverUrl: "ma-couverture.jpg" });
    // un doublon sans jaquette efface celle d'une autre édition
    const noCover = planDuplicateMerges([
      lb("a", "Le trône de diamant", ["David Eddings"], "9782298006094", "2026-10-01T10:00:00Z", { coverUrl: "autre.jpg" }),
      lb("b", "Le trone de diamant la trilogie des joyaux I", ["Eddings"], "9782266110075", "2026-10-05T10:00:00Z", { owned: true })
    ]);
    expect(noCover[0].edition?.coverUrl).toBeNull();
    // une fiche déjà possédée garde son édition
    const keeperOwned = planDuplicateMerges([
      lb("a", "Dune", ["Frank Herbert"], "1", "2026-10-01T10:00:00Z", { owned: true }),
      lb("b", "Dune", ["Frank Herbert"], "2", "2026-10-05T10:00:00Z", { owned: true })
    ]);
    expect(keeperOwned[0].edition).toBeUndefined();
  });
  it("tells an owned book with another edition apart", async () => {
    const { createWorkIndex, libraryStateOf } = await import("../src/lib/library-view");
    const index = createWorkIndex([lb("a", "Le trône de diamant", ["David Eddings"], "9782298006094", "2026-10-01T10:00:00Z", { owned: true })]);
    const result = (isbn13: string) => ({ source: "open-library", sourceId: "ol:" + isbn13, title: "Le trone de diamant la trilogie des joyaux I", authors: ["Eddings"], isbn13 }) as never;
    expect(libraryStateOf(result("9782266110075"), index)).toBe("owned-other-edition");
    expect(libraryStateOf(result("9782298006094"), index)).toBe("owned");
  });
});

describe("displayTitle", () => {
  it("drops the catalogue statement of responsibility but keeps real titles", async () => {
    const { displayTitle } = await import("../src/lib/library-view");
    expect(displayTitle("Le trône de diamant / David Eddings ; [trad. par E. C. L. Meistermann]")).toBe("Le trône de diamant");
    expect(displayTitle("Le Cri : thriller (Nouvelle éd.)")).toBe("Le Cri : thriller (Nouvelle éd.)");
    expect(displayTitle("Dune")).toBe("Dune");
    expect(displayTitle("/ seul")).toBe("/ seul");
  });
});

describe("cover candidates", () => {
  it("lists the edition's own covers first, then other editions (French first), without duplicates", async () => {
    const { assembleCandidates } = await import("../src/services/coverCandidates");
    const list = assembleCandidates({
      isbn: "9782266033756", exactOpenLibrary: true, amazonUrl: "https://images-na.ssl-images-amazon.com/images/P/2266033751.01.LZZZZZZZ.jpg",
      editionCovers: [979538, 111],
      workCovers: [1000455, 979538, 222],
      otherEditions: [
        { covers: [1000455], publishers: ["Corgi"], publish_date: "1983" },
        { covers: [979538, 333], publishers: ["Pocket"], publish_date: "January 1, 1990", languages: [{ key: "/languages/fre" }] },
        { covers: [] }
      ]
    });
    expect(list.map(c => c.id)).toEqual(["ol-isbn", "amazon", "ed-111", "w-333", "w-1000455", "w-222"]);
    expect(list.slice(0, 3).every(c => c.exact)).toBe(true);
    expect(list.find(c => c.id === "w-333")?.label).toBe("Pocket 1990 · FR");
    expect(list.find(c => c.id === "w-1000455")?.label).toBe("Corgi 1983");
    expect(assembleCandidates({ isbn: "1", exactOpenLibrary: false, editionCovers: [], workCovers: [], otherEditions: [] })).toEqual([]);
    // adresse par ISBN muette : la jaquette de l'édition reste proposée, en premier
    const fallback = assembleCandidates({ isbn: "1", exactOpenLibrary: false, editionCovers: [979538], workCovers: [979538, 5], otherEditions: [] });
    expect(fallback.map(c => c.id)).toEqual(["ed-979538", "w-5"]);
    expect(fallback[0].exact).toBe(true);
  });
});

describe("cover image sizing", () => {
  it("reduces large photos to the maximum side and never enlarges small ones", async () => {
    const { fitSize } = await import("../src/services/coverImage");
    expect(fitSize(3000, 4000)).toEqual({ width: 480, height: 640 });
    expect(fitSize(4000, 3000)).toEqual({ width: 640, height: 480 });
    expect(fitSize(300, 450)).toEqual({ width: 300, height: 450 });
    expect(fitSize(1, 5000)).toEqual({ width: 1, height: 640 });
  });
});

describe("Google covers in the picker", () => {
  it("adds Google thumbnails after the edition's own covers, without duplicates", async () => {
    const { assembleCandidates } = await import("../src/services/coverCandidates");
    const list = assembleCandidates({
      isbn: "2266033751", exactOpenLibrary: true, amazonUrl: "https://a/x.jpg", editionCovers: [1], workCovers: [],
      otherEditions: [], googleCovers: [{ url: "https://g/1.jpg", label: "Google Books" }, { url: "https://g/1.jpg", label: "Google Books (autre fiche)" }, { url: "https://g/2.jpg", label: "Google Books (autre fiche)" }]
    });
    expect(list.map(c => c.id)).toEqual(["ol-isbn", "amazon", "g-2", "g-3"]);
    expect(list.filter(c => c.label.startsWith("Google")).map(c => c.url)).toEqual(["https://g/1.jpg", "https://g/2.jpg"]);
  });
});

describe("backup", () => {
  const lb = (id: string, title: string, authors: string[], isbn13: string, extra: object = {}) =>
    ({ id, source: "bnf", sourceId: id, title, authors, isbn13, addedAt: "2026-10-01T10:00:00Z", owned: false, favorite: false, status: "TO_READ", ...extra }) as never;

  it("builds a file that parses back to the same books", async () => {
    const { buildBackup, parseBackup, backupFileName } = await import("../src/lib/backup");
    const library = [lb("1", "Dune", ["Frank Herbert"], "9782266233200", { owned: true, status: "READ", rating: 5, coverUrl: "data:image/jpeg;base64,AAAA", seriesName: "Dune", seriesVolume: 1 })];
    const backup = buildBackup(library, [{ authorKey: "frank herbert", name: "Frank Herbert", lastRefreshedAt: "2026-10-01T00:00:00Z" }], new Date("2026-10-08T12:00:00Z"));
    const parsed = parseBackup(JSON.stringify(backup));
    expect(parsed.books[0]).toMatchObject({ title: "Dune", owned: true, status: "READ", rating: 5, coverUrl: "data:image/jpeg;base64,AAAA", seriesName: "Dune", seriesVolume: 1 });
    expect(parsed.followedAuthors).toEqual([{ authorKey: "frank herbert", name: "Frank Herbert", lastRefreshedAt: "2026-10-01T00:00:00Z" }]);
    expect(backupFileName(new Date("2026-10-08T12:00:00Z"))).toBe("tsundoku-sauvegarde-2026-10-08.json");
  });

  it("refuses foreign or newer files and sanitises odd values", async () => {
    const { parseBackup } = await import("../src/lib/backup");
    expect(() => parseBackup("pas du json")).toThrow("illisible");
    expect(() => parseBackup(JSON.stringify({ app: "autre", books: [] }))).toThrow("pas une sauvegarde Tsundoku");
    expect(() => parseBackup(JSON.stringify({ app: "tsundoku", format: 99, books: [] }))).toThrow("plus récente");
    const parsed = parseBackup(JSON.stringify({ app: "tsundoku", format: 1, books: [
      { title: "A", rating: 9, status: "BIZARRE", coverUrl: "http://exemple.fr/x.jpg", authors: ["X", 3] },
      { title: "", authors: [] }, { nothing: true }
    ] }));
    expect(parsed.books).toHaveLength(1);
    expect(parsed.books[0]).toMatchObject({ title: "A", rating: undefined, status: "TO_READ", coverUrl: undefined, authors: ["X"], owned: true });
  });

  it("merges into existing books without overwriting, and adds the others", async () => {
    const { planImport } = await import("../src/lib/backup");
    const library = [
      lb("a", "Le trône de diamant / David Eddings", ["David Eddings"], "9782298006094"),
      lb("b", "Dune", ["Frank Herbert"], "9782266233200", { owned: true, status: "READING", rating: 3 })
    ];
    const book = (title: string, authors: string[], isbn13: string, extra: object = {}) =>
      ({ title, authors, source: "open-library", sourceId: `x-${title}`, isbn13, owned: true, favorite: false, status: "TO_READ", ...extra }) as never;
    const plan = planImport({ app: "tsundoku", format: 1, exportedAt: "", followedAuthors: [], books: [
      book("Le trone de diamant la trilogie des joyaux I", ["Eddings"], "9782266110075", { status: "READ", rating: 5, coverUrl: "https://c/x.jpg", publisher: "Pocket" }),
      book("Dune", ["Frank Herbert"], "9782266233200", { status: "READ", rating: 5, favorite: true }),
      book("Les Dômes de feu", ["David Eddings"], "9782266999999")
    ] }, library);
    expect(plan.add.map(b => b.title)).toEqual(["Les Dômes de feu"]);
    const first = plan.merge.find(m => m.id === "a")!;
    expect(first.state).toMatchObject({ owned: true, status: "READ", rating: 5 });
    expect(first.edition).toMatchObject({ isbn13: "9782266110075", publisher: "Pocket", coverUrl: "https://c/x.jpg" });
    // Dune : déjà possédé, noté 3 → la note locale reste ; statut plus avancé et favori repris
    const dune = plan.merge.find(m => m.id === "b")!;
    expect(dune.state).toEqual({ favorite: true, status: "READ" });
    expect(dune.edition).toBeUndefined();
    // un second import identique ne change plus rien
    const again = planImport({ app: "tsundoku", format: 1, exportedAt: "", followedAuthors: [], books: [book("Dune", ["Frank Herbert"], "9782266233200", { status: "READING", rating: 3 })] }, library);
    expect(again).toMatchObject({ add: [], merge: [], unchanged: 1 });
  });
});
