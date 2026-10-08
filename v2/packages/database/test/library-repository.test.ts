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

describe("reading sessions", () => {
  it("records a session, moves the book to READING and updates progress", async () => {
    await repo.add(dune);
    const [{ id }] = await repo.list();
    await repo.addReadingSession(id, { startedAt: "2026-01-01T10:00", durationMinutes: 45, endProgress: 120 });
    expect((await repo.list())[0]).toMatchObject({ status: "READING", progressValue: 120 });
    const [session] = await repo.listReadingSessions(id);
    expect(session).toMatchObject({ durationMinutes: 45, endProgress: 120 });
  });
  it("validates duration and progress", async () => {
    await repo.add(dune);
    const [{ id }] = await repo.list();
    await expect(repo.addReadingSession(id, { startedAt: "x", durationMinutes: 0 })).rejects.toThrow("durée");
    await expect(repo.addReadingSession(id, { startedAt: "x", durationMinutes: 5, endProgress: 9999 })).rejects.toThrow("dépasser");
    await expect(repo.addReadingSession(id, { startedAt: "x", durationMinutes: 5, endProgress: -1 })).rejects.toThrow("négative");
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
