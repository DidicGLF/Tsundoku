import { beforeEach, describe, expect, it } from "vitest";
import { runMigrations, SCHEMA_VERSION } from "../src/migrations";
import { SqliteLibraryRepository } from "../src/library-repository";
import type { NewLibraryBook } from "../src/types";
import { createTestAdapter } from "./sqljs-adapter";

const dune: NewLibraryBook = {
  source: "open-library", sourceId: "OL1W", title: "Dune", authors: ["Frank Herbert"],
  isbn13: "9780441172719", pageCount: 600, seriesName: "Dune", seriesVolume: 1
};

let db: Awaited<ReturnType<typeof createTestAdapter>>;
let repo: SqliteLibraryRepository;

beforeEach(async () => {
  db = await createTestAdapter();
  await runMigrations(db);
  repo = new SqliteLibraryRepository(db);
});

describe("migrations", () => {
  it("creates the schema and records the version", async () => {
    const [{ user_version }] = await db.query<{ user_version: number }>("PRAGMA user_version");
    expect(user_version).toBe(SCHEMA_VERSION);
  });
  it("is idempotent", async () => {
    await repo.add(dune);
    await runMigrations(db);
    expect(await repo.list()).toHaveLength(1);
  });
  it("replaces a pre-release database instead of failing on it", async () => {
    const old = await createTestAdapter();
    await old.execute("CREATE TABLE library_books (id TEXT PRIMARY KEY)");
    await old.execute("CREATE TABLE books (id TEXT PRIMARY KEY, legacy_only TEXT)");
    await runMigrations(old);
    const tables = (await old.query<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table'")).map(t => t.name);
    expect(tables).not.toContain("library_books");
    await expect(new SqliteLibraryRepository(old).add(dune)).resolves.toBeUndefined();
  });
});

describe("upgrading from schema version 1", () => {
  it("keeps the user's books, adds the rating column and drops the reading journal", async () => {
    const old = await createTestAdapter();
    await runMigrations(old, 1);
    const now = "2026-01-01T00:00:00Z";
    await old.execute("INSERT INTO books(id,title,source,source_id,created_at,updated_at) VALUES('b1','Dune','bnf','x',?,?)", [now, now]);
    await old.execute("INSERT INTO user_books(id,user_id,book_id,created_at,updated_at) VALUES('u1','local','b1',?,?)", [now, now]);
    await old.execute("INSERT INTO reading_sessions(id,user_book_id,started_at,duration_minutes,created_at,updated_at) VALUES('s1','u1',?,30,?,?)", [now, now, now]);
    await runMigrations(old);
    const upgraded = new SqliteLibraryRepository(old);
    expect(await upgraded.list()).toHaveLength(1);
    await upgraded.update("u1", { rating: 5 });
    expect((await upgraded.list())[0].rating).toBe(5);
    const tables = await old.query<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'");
    expect(tables.map(t => t.name)).not.toContain("reading_sessions");
  });
});

describe("upgrading from schema version 2", () => {
  it("moves a BnF « Collection : … » note into the collection column and drops catalogue notes from the description", async () => {
    const old = await createTestAdapter();
    await runMigrations(old, 2);
    const now = "2026-01-01T00:00:00Z";
    for (const [id, description] of [["1", "Collection : Pocket. Science-fiction"], ["2", "Code à barres commercial : EAN 9782811207984"], ["3", "x".repeat(150)]]) {
      await old.execute("INSERT INTO books(id,title,description,source,source_id,created_at,updated_at) VALUES(?,?,?,'bnf',?,?,?)", [id, `Livre ${id}`, description, id, now, now]);
      await old.execute("INSERT INTO editions(id,book_id,created_at,updated_at) VALUES(?,?,?,?)", [`e${id}`, id, now, now]);
      await old.execute("INSERT INTO user_books(id,user_id,book_id,edition_id,created_at,updated_at) VALUES(?,'local',?,?,?,?)", [`u${id}`, id, `e${id}`, now, now]);
    }
    await runMigrations(old);
    const list = await new SqliteLibraryRepository(old).list();
    const byTitle = (t: string) => list.find(b => b.title === t)!;
    expect(byTitle("Livre 1")).toMatchObject({ collection: "Pocket. Science-fiction", description: undefined });
    expect(byTitle("Livre 2")).toMatchObject({ collection: undefined, description: undefined });
    expect(byTitle("Livre 3").description).toHaveLength(150);
  });
});

describe("collection", () => {
  it("is stored with the edition, kept by setEdition and filled in by refreshMetadata without overwriting", async () => {
    await repo.add({ ...dune, collection: "Pocket. Science-fiction" });
    const [{ id }] = await repo.list();
    expect((await repo.list())[0].collection).toBe("Pocket. Science-fiction");
    await repo.refreshMetadata(id, { ...dune, collection: "Autre" });
    expect((await repo.list())[0].collection).toBe("Pocket. Science-fiction");
    await repo.setEdition(id, { collection: "J'ai lu. Fantasy" });
    expect((await repo.list())[0].collection).toBe("J'ai lu. Fantasy");
    await repo.addMany([{ ...dune, sourceId: "OL2", isbn13: "9780000000002", title: "Autre", collection: "Pocket" }]);
    expect((await repo.list()).find(b => b.title === "Autre")?.collection).toBe("Pocket");
  });
});

describe("migrating a pre-release database with foreign keys enforced", () => {
  it("drops parent and child tables even when PRAGMA foreign_keys cannot be switched off", async () => {
    const old = await createTestAdapter({ ignoreForeignKeysPragma: true });
    old.raw.run("PRAGMA foreign_keys = ON");
    old.raw.run("CREATE TABLE books (id TEXT PRIMARY KEY)");
    old.raw.run("CREATE TABLE editions (id TEXT PRIMARY KEY, book_id TEXT REFERENCES books(id))");
    old.raw.run("CREATE TABLE library_books (id TEXT PRIMARY KEY)");
    old.raw.run("INSERT INTO books VALUES ('b1')");
    old.raw.run("INSERT INTO editions VALUES ('e1', 'b1')");
    await expect(runMigrations(old)).resolves.toBeUndefined();
    await expect(new SqliteLibraryRepository(old).add(dune)).resolves.toBeUndefined();
  });
});

describe("add / list", () => {
  it("stores a book with authors in order, series and edition data", async () => {
    await repo.add({ ...dune, authors: ["Frank Herbert", "Brian Herbert"], publisher: "Ace", publishedYear: 1965 });
    const [book] = await repo.list();
    expect(book).toMatchObject({
      title: "Dune", authors: ["Frank Herbert", "Brian Herbert"], source: "open-library", sourceId: "OL1W",
      isbn13: "9780441172719", publisher: "Ace", publishedYear: 1965, seriesName: "Dune", seriesVolume: 1,
      status: "TO_READ", owned: true, favorite: false, progressTotal: 600
    });
  });
  it("keeps the BnF source", async () => {
    await repo.add({ ...dune, source: "bnf", sourceId: "ark:/12148/x", isbn13: undefined });
    expect((await repo.list())[0]).toMatchObject({ source: "bnf", sourceId: "ark:/12148/x" });
  });
  it("shares an author between books and lists authors of each book separately", async () => {
    await repo.add(dune);
    await repo.add({ ...dune, sourceId: "OL2W", title: "Dune Messiah", isbn13: "9780593098233", authors: ["frank  herbert"] });
    const rows = await db.query<{ n: number }>("SELECT COUNT(*) AS n FROM authors");
    expect(rows[0].n).toBe(1);
    expect((await repo.list()).every(b => b.authors.length === 1)).toBe(true);
  });
  it("keeps non-latin authors distinct", async () => {
    await repo.add({ ...dune, sourceId: "a", isbn13: undefined, title: "千と千尋", authors: ["宮崎駿"] });
    await repo.add({ ...dune, sourceId: "b", isbn13: undefined, title: "ワンピース", authors: ["尾田栄一郎"] });
    const books = await repo.list();
    expect(books.map(b => b.authors[0]).sort()).toEqual(["宮崎駿", "尾田栄一郎"].sort());
  });
  it("does not duplicate a book added twice (same ISBN, other source)", async () => {
    await repo.add(dune);
    await repo.add({ ...dune, source: "google-books", sourceId: "g1" });
    expect(await repo.list()).toHaveLength(1);
  });
  it("adds many books in one batch and rolls the whole batch back on failure", async () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ ...dune, sourceId: `OL${i}`, isbn13: `97800000${String(i).padStart(5, "0")}`, title: `Livre ${i}`, seriesName: undefined }));
    await repo.batch(async () => { for (const book of many) await repo.add(book); });
    expect(await repo.list()).toHaveLength(50);

    await expect(repo.batch(async () => {
      await repo.add({ ...dune, sourceId: "extra", isbn13: "9781111111111" });
      throw new Error("boom");
    })).rejects.toThrow("boom");
    expect(await repo.list()).toHaveLength(50);
  });
  it("addMany matches add: dedup, shared authors and series, existing books untouched", async () => {
    await repo.add({ ...dune, owned: true });
    const inputs: NewLibraryBook[] = [
      { ...dune, owned: false },
      { source: "bnf", sourceId: "b1", title: "Dune 2", authors: ["Frank Herbert", "Brian Herbert"], isbn13: "9782266000001", seriesName: "Dune", seriesVolume: 2, owned: false },
      { source: "bnf", sourceId: "b2", title: "Autre", authors: ["Brian Herbert"], owned: false },
      { source: "bnf", sourceId: "b2", title: "Autre (bis)", authors: ["Brian Herbert"], owned: false }
    ];
    await repo.addMany(inputs);
    const list = await repo.list();
    expect(list).toHaveLength(3);
    const dune2 = list.find(b => b.title === "Dune 2")!;
    expect(dune2.authors).toEqual(["Frank Herbert", "Brian Herbert"]);
    expect(dune2.seriesName).toBe("Dune");
    expect(dune2.owned).toBe(false);
    expect(list.find(b => b.title === "Dune")!.owned).toBe(true);
    expect((await db.query("SELECT id FROM authors")).length).toBe(2);
    expect((await db.query("SELECT id FROM series")).length).toBe(1);
  });
  it("addMany restores soft-deleted books and upgrades owned ones like add", async () => {
    await repo.add({ ...dune, owned: false });
    const [stored] = await repo.list();
    await repo.remove(stored.id);
    expect(await repo.list()).toHaveLength(0);
    await repo.addMany([{ ...dune, owned: false, newlyDiscovered: true }]);
    let list = await repo.list();
    expect(list).toHaveLength(1);
    expect(list[0].newlyDiscovered).toBe(true);
    expect(list[0].owned).toBe(false);
    await repo.addMany([{ ...dune, owned: true }, { ...dune, owned: false }]);
    list = await repo.list();
    expect(list).toHaveLength(1);
    expect(list[0].owned).toBe(true);
  });
  it("marks a tracked book as owned when added again as owned, but not when re-imported", async () => {
    await repo.add({ ...dune, owned: false, newlyDiscovered: true });
    await repo.add({ ...dune, owned: false, newlyDiscovered: true });
    expect((await repo.list())[0]).toMatchObject({ owned: false, newlyDiscovered: true });
    await repo.add({ ...dune, owned: true });
    expect((await repo.list())[0]).toMatchObject({ owned: true, newlyDiscovered: false });
  });
  it("rolls back everything when an insert fails", async () => {
    await expect(repo.add({ ...dune, title: undefined as unknown as string })).rejects.toThrow();
    expect(await repo.list()).toHaveLength(0);
    expect((await db.query<{ n: number }>("SELECT COUNT(*) AS n FROM books"))[0].n).toBe(0);
  });
});

describe("remove / restore", () => {
  it("soft-deletes, then restores with a fresh reading state", async () => {
    await repo.add(dune);
    const [{ id }] = await repo.list();
    await repo.update(id, { status: "READ", favorite: true });
    await repo.remove(id);
    expect(await repo.list()).toHaveLength(0);
    await repo.add(dune);
    const [restored] = await repo.list();
    expect(restored).toMatchObject({ id, status: "TO_READ", favorite: false });
    expect(restored.finishedAt).toBeUndefined();
  });
  it("throws for an unknown book", async () => {
    await expect(repo.remove("nope")).rejects.toThrow("introuvable");
    await expect(repo.update("nope", {})).rejects.toThrow("introuvable");
  });
});

describe("update", () => {
  it("sets and clears reading dates with the status", async () => {
    await repo.add(dune);
    const [{ id }] = await repo.list();
    await repo.update(id, { status: "READING" });
    expect((await repo.list())[0].startedAt).toBeDefined();
    await repo.update(id, { status: "READ" });
    const read = (await repo.list())[0];
    expect(read.finishedAt).toBeDefined();
    await repo.update(id, { favorite: true });
    expect((await repo.list())[0].finishedAt).toBe(read.finishedAt);
    await repo.update(id, { status: "TO_READ" });
    expect((await repo.list())[0].finishedAt).toBeUndefined();
  });
  it("edits and removes the series", async () => {
    await repo.add(dune);
    const [{ id }] = await repo.list();
    await repo.update(id, { seriesVolume: 2 });
    expect((await repo.list())[0]).toMatchObject({ seriesName: "Dune", seriesVolume: 2 });
    await repo.update(id, { seriesName: "Cycle de Dune", seriesVolume: 3 });
    expect((await repo.list())[0]).toMatchObject({ seriesName: "Cycle de Dune", seriesVolume: 3 });
    await repo.update(id, { seriesName: "" });
    expect((await repo.list())[0].seriesName).toBeUndefined();
  });
});

describe("refreshMetadata", () => {
  it("fills missing fields without overwriting existing ones", async () => {
    await repo.add({ ...dune, description: "Original" });
    const [{ id }] = await repo.list();
    await repo.refreshMetadata(id, { ...dune, description: "Other", coverUrl: "c.jpg", publisher: "Ace" });
    expect((await repo.list())[0]).toMatchObject({ description: "Original", coverUrl: "c.jpg", publisher: "Ace" });
  });
});

describe("backup helpers", () => {
  it("applyState writes dates and ratings as given, importBook restores a full book once", async () => {
    await repo.importBook(dune, { owned: true, status: "READ", rating: 4, favorite: true, startedAt: "2025-03-01T10:00:00Z", finishedAt: "2025-03-20T10:00:00Z", progressValue: 600, progressTotal: 600 });
    const [book] = await repo.list();
    expect(book).toMatchObject({ owned: true, status: "READ", rating: 4, favorite: true, startedAt: "2025-03-01T10:00:00Z", finishedAt: "2025-03-20T10:00:00Z", progressValue: 600 });
    // même livre importé deux fois : pas de doublon, l'état est réécrit
    await repo.importBook(dune, { status: "READING", finishedAt: null });
    expect(await repo.list()).toHaveLength(1);
    expect((await repo.list())[0]).toMatchObject({ status: "READING", finishedAt: undefined, rating: 4 });
    await expect(repo.applyState(book.id, { rating: 9 })).rejects.toThrow("1 à 5");
  });
  it("lists followed authors", async () => {
    await repo.upsertFollowedAuthor("frank herbert", "Frank Herbert", "2026-01-01T00:00:00Z");
    await repo.upsertFollowedAuthor("david eddings", "David Eddings", "2026-02-01T00:00:00Z");
    expect((await repo.listFollowedAuthors()).map(a => a.name)).toEqual(["David Eddings", "Frank Herbert"]);
  });
});

describe("setEdition", () => {
  it("replaces ISBN, publisher and cover with the owned edition, clears a cover on request, keeps what is not given", async () => {
    await repo.add({ ...dune, coverUrl: "old.jpg", publisher: "Ace", pageCount: 600 });
    const [{ id }] = await repo.list();
    await repo.setEdition(id, { isbn13: "9782266110075", isbn10: "2266110071", publisher: "Pocket", coverUrl: "mine.jpg" });
    expect((await repo.list())[0]).toMatchObject({ isbn13: "9782266110075", isbn10: "2266110071", publisher: "Pocket", coverUrl: "mine.jpg", pageCount: 600 });
    await repo.setEdition(id, { coverUrl: null });
    expect((await repo.list())[0].coverUrl).toBeUndefined();
    await repo.setEdition(id, { publisher: "Poche" });
    expect((await repo.list())[0]).toMatchObject({ publisher: "Poche", isbn13: "9782266110075" });
  });
});

describe("rating", () => {
  it("stores 1-5 stars, keeps them across other updates and clears them with null", async () => {
    await repo.add(dune);
    const [{ id }] = await repo.list();
    expect((await repo.list())[0].rating).toBeUndefined();
    await repo.update(id, { status: "READ", rating: 4 });
    expect((await repo.list())[0]).toMatchObject({ status: "READ", rating: 4 });
    await repo.update(id, { favorite: true });
    expect((await repo.list())[0].rating).toBe(4);
    await repo.update(id, { rating: null });
    expect((await repo.list())[0].rating).toBeUndefined();
  });
  it("refuses ratings outside 1-5", async () => {
    await repo.add(dune);
    const [{ id }] = await repo.list();
    for (const bad of [0, 6, 2.5]) await expect(repo.update(id, { rating: bad })).rejects.toThrow("1 à 5");
  });
  it("no longer has a reading journal", async () => {
    const tables = await db.query<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'");
    expect(tables.map(t => t.name)).not.toContain("reading_sessions");
  });
});

describe("followed authors", () => {
  it("upserts, reads and removes", async () => {
    await repo.upsertFollowedAuthor("frank herbert", "Frank Herbert", "2026-01-01T00:00:00Z");
    await repo.upsertFollowedAuthor("frank herbert", "Frank Herbert", "2026-02-01T00:00:00Z");
    expect(await repo.getFollowedAuthor("frank herbert")).toMatchObject({ lastRefreshedAt: "2026-02-01T00:00:00Z" });
    await repo.removeFollowedAuthor("frank herbert");
    expect(await repo.getFollowedAuthor("frank herbert")).toBeNull();
  });
});
