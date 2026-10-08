import { describe, expect, it } from "vitest";
import { runMigrations, SqliteLibraryRepository } from "@tsundoku/database";
import { createTestAdapter } from "../../../packages/database/test/sqljs-adapter";
import { applyImportTo, buildBackup, parseBackup, planImport } from "../src/lib/backup";

async function freshRepo() {
  const db = await createTestAdapter();
  await runMigrations(db);
  return new SqliteLibraryRepository(db);
}

describe("backup round trip on real SQL", () => {
  it("restores books, user data and followed authors into an empty library, and a second import changes nothing", async () => {
    const source = await freshRepo();
    await source.importBook(
      { source: "bnf", sourceId: "a", title: "Le trône de diamant", authors: ["David Eddings"], isbn13: "9782266110075", publisher: "Pocket", collection: "Pocket. Science-fiction", pageCount: 410, coverUrl: "data:image/jpeg;base64,AAAA", seriesName: "La trilogie des joyaux", seriesVolume: 1 },
      { owned: true, status: "READ", rating: 5, favorite: true, startedAt: "2025-03-01T10:00:00Z", finishedAt: "2025-03-20T10:00:00Z" }
    );
    await source.add({ source: "bnf", sourceId: "b", title: "Le chevalier de rubis", authors: ["David Eddings"], isbn13: "9782266064668", owned: false });
    await source.upsertFollowedAuthor("david eddings", "David Eddings", "2026-10-01T00:00:00Z");

    const backup = parseBackup(JSON.stringify(buildBackup(await source.list(), await source.listFollowedAuthors())));

    const target = await freshRepo();
    const report = await applyImportTo(target, planImport(backup, await target.list()), backup);
    expect(report).toMatchObject({ added: 2, merged: 0, authors: 1 });

    const restored = await target.list();
    const diamant = restored.find(b => b.title === "Le trône de diamant")!;
    expect(diamant).toMatchObject({
      owned: true, status: "READ", rating: 5, favorite: true, startedAt: "2025-03-01T10:00:00Z", finishedAt: "2025-03-20T10:00:00Z",
      isbn13: "9782266110075", publisher: "Pocket", collection: "Pocket. Science-fiction", pageCount: 410, coverUrl: "data:image/jpeg;base64,AAAA",
      seriesName: "La trilogie des joyaux", seriesVolume: 1, authors: ["David Eddings"]
    });
    expect(restored.find(b => b.title === "Le chevalier de rubis")).toMatchObject({ owned: false, status: "TO_READ" });
    expect((await target.listFollowedAuthors()).map(a => a.name)).toEqual(["David Eddings"]);

    // le même fichier importé une seconde fois : aucun doublon, rien à faire
    const again = await applyImportTo(target, planImport(backup, restored), backup);
    expect(again).toMatchObject({ added: 0, merged: 0, unchanged: 2 });
    expect(await target.list()).toHaveLength(2);
  });

  it("merges a backup into a library that already has the book as a missing entry", async () => {
    const source = await freshRepo();
    await source.importBook({ source: "open-library", sourceId: "ol", title: "Le trone de diamant la trilogie des joyaux I", authors: ["Eddings"], isbn13: "9782266110075", coverUrl: "https://covers.openlibrary.org/b/isbn/9782266110075-L.jpg" }, { owned: true, status: "READ", rating: 5 });
    const backup = buildBackup(await source.list(), []);

    const target = await freshRepo();
    await target.add({ source: "bnf", sourceId: "cb", title: "Le trône de diamant / David Eddings ; [trad.]", authors: ["David Eddings"], isbn13: "9782298006094", owned: false });
    const report = await applyImportTo(target, planImport(backup, await target.list()), backup);
    expect(report).toMatchObject({ added: 0, merged: 1 });
    const [book] = await target.list();
    expect(book).toMatchObject({ owned: true, status: "READ", rating: 5, isbn13: "9782266110075", authors: ["David Eddings"] });
  });
});
