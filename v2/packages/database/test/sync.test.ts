import { beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../src/migrations";
import { SqliteLibraryRepository } from "../src/library-repository";
import { syncOnce, useSyncIdentity } from "../src/sync";
import type { NewLibraryBook } from "../src/types";
import { createTestAdapter } from "./sqljs-adapter";
import { FakeServer } from "./fake-server";

const dune: NewLibraryBook = {
  source: "open-library", sourceId: "OL1W", title: "Dune", authors: ["Frank Herbert"],
  isbn13: "9780441172719", pageCount: 600, seriesName: "Cycle de Dune", seriesVolume: 1, coverUrl: "https://x/dune.jpg"
};
const hyperion: NewLibraryBook = { source: "bnf", sourceId: "b1", title: "Hypérion", authors: ["Dan Simmons"], isbn13: "9782070415236", owned: false };

async function device() {
  const db = await createTestAdapter();
  await runMigrations(db);
  return new SqliteLibraryRepository(db);
}

/** Horloge qui avance à chaque appel : les versions ont des dates distinctes et ordonnées. */
let tick = 0;
const clock = () => new Date(Date.UTC(2026, 0, 1, 0, 0, ++tick)).toISOString();
const sleep = () => new Promise(resolve => setTimeout(resolve, 5));

let phone: SqliteLibraryRepository;
let pc: SqliteLibraryRepository;
let server: FakeServer;

beforeEach(async () => {
  phone = await device();
  pc = await device();
  server = new FakeServer();
});

describe("sync", () => {
  it("copies a library to an empty device, with all the user's data", async () => {
    await phone.add(dune);
    await phone.add(hyperion);
    const [d] = (await phone.list()).filter(b => b.title === "Dune");
    await phone.update(d.id, { status: "READ", rating: 5, favorite: true });
    await phone.upsertFollowedAuthor("frank herbert", "Frank Herbert", "2026-02-01T00:00:00Z");

    const t = server.transport();
    const sent = await syncOnce(phone, t, clock);
    expect(sent.pushed).toBe(2);
    const received = await syncOnce(pc, t, clock);
    expect(received.received).toBe(2);
    expect(received.followedReceived).toBe(1);

    const [copy] = (await pc.list()).filter(b => b.title === "Dune");
    expect(copy).toMatchObject({
      id: d.id, authors: ["Frank Herbert"], isbn13: "9780441172719", seriesName: "Cycle de Dune", seriesVolume: 1,
      status: "READ", rating: 5, favorite: true, owned: true, coverUrl: "https://x/dune.jpg", pageCount: 600
    });
    expect(copy.updatedAt).toBe((await phone.list()).find(b => b.title === "Dune")!.updatedAt);
    expect((await pc.list()).find(b => b.title === "Hypérion")?.owned).toBe(false);
    expect(await pc.listFollowedAuthors()).toEqual([{ authorKey: "frank herbert", name: "Frank Herbert", lastRefreshedAt: "2026-02-01T00:00:00Z" }]);
  });

  it("propagates an edit, in both directions", async () => {
    await phone.add(dune);
    const t = server.transport();
    await syncOnce(phone, t, clock);
    await syncOnce(pc, t, clock);

    await sleep();
    const id = (await pc.list())[0].id;
    await pc.update(id, { status: "READING", progressValue: 120 });
    await syncOnce(pc, t, clock);
    await syncOnce(phone, t, clock);
    expect((await phone.list())[0]).toMatchObject({ status: "READING", progressValue: 120 });

    await sleep();
    await phone.update(id, { rating: 4, favorite: true });
    await syncOnce(phone, t, clock);
    await syncOnce(pc, t, clock);
    expect((await pc.list())[0]).toMatchObject({ rating: 4, favorite: true, status: "READING" });
  });

  it("propagates a deletion and does not bring the book back", async () => {
    await phone.add(dune);
    await phone.add(hyperion);
    const t = server.transport();
    await syncOnce(phone, t, clock);
    await syncOnce(pc, t, clock);

    await sleep();
    await pc.remove((await pc.list()).find(b => b.title === "Dune")!.id);
    await syncOnce(pc, t, clock);
    await syncOnce(phone, t, clock);
    expect((await phone.list()).map(b => b.title)).toEqual(["Hypérion"]);

    await syncOnce(pc, t, clock);
    await syncOnce(phone, t, clock);
    expect((await phone.list()).map(b => b.title)).toEqual(["Hypérion"]);
    expect((await pc.list()).map(b => b.title)).toEqual(["Hypérion"]);
  });

  it("keeps the most recent edit when both devices edited the same book", async () => {
    await phone.add(dune);
    const t = server.transport();
    await syncOnce(phone, t, clock);
    await syncOnce(pc, t, clock);
    const id = (await phone.list())[0].id;

    await sleep();
    await phone.update(id, { rating: 2 });   // plus ancien
    await sleep();
    await pc.update(id, { rating: 5 });      // plus récent
    await syncOnce(pc, t, clock);
    await syncOnce(phone, t, clock);          // le téléphone reçoit 5, et n'écrase pas avec son 2
    await syncOnce(pc, t, clock);
    expect((await phone.list())[0].rating).toBe(5);
    expect((await pc.list())[0].rating).toBe(5);
  });

  it("a second sync with nothing new sends and applies nothing", async () => {
    await phone.add(dune);
    const t = server.transport();
    await syncOnce(phone, t, clock);
    await syncOnce(pc, t, clock);
    await sleep();
    const again = await syncOnce(pc, t, clock);
    expect(again.received).toBe(0);
    expect(again.followedReceived).toBe(0);
    expect((await syncOnce(phone, t, clock)).received).toBe(0);
  });

  it("an unfollowed author disappears on the other device", async () => {
    await phone.upsertFollowedAuthor("a", "A", "2026-02-01T00:00:00Z");
    const t = server.transport();
    await syncOnce(phone, t, clock);
    await syncOnce(pc, t, clock);
    expect(await pc.listFollowedAuthors()).toHaveLength(1);
    await sleep();
    await phone.removeFollowedAuthor("a");
    await syncOnce(phone, t, clock);
    await syncOnce(pc, t, clock);
    expect(await pc.listFollowedAuthors()).toHaveLength(0);
    // suivre à nouveau fonctionne
    await sleep();
    await pc.upsertFollowedAuthor("a", "A", "2026-03-01T00:00:00Z");
    await syncOnce(pc, t, clock);
    await syncOnce(phone, t, clock);
    expect(await phone.listFollowedAuthors()).toHaveLength(1);
  });

  it("the same book added on both devices stays as two entries (the app merges duplicates afterwards), without breaking", async () => {
    await phone.add(dune);
    await pc.add(dune);
    const t = server.transport();
    await syncOnce(phone, t, clock);
    await syncOnce(pc, t, clock);
    await syncOnce(phone, t, clock);
    const onPhone = await phone.list();
    const onPc = await pc.list();
    expect(onPhone).toHaveLength(2);
    expect(onPc.map(b => b.id).sort()).toEqual(onPhone.map(b => b.id).sort());
  });

  it("transfers a large library in several pushes and pages", async () => {
    await phone.addMany(Array.from({ length: 250 }, (_, i) => ({
      source: "bnf" as const, sourceId: `s${i}`, title: `Livre ${i}`, authors: ["Auteur"], isbn13: `978000000${String(i).padStart(4, "0")}`
    })));
    const t = server.transport();
    await syncOnce(phone, t, clock);
    expect(server.pushes).toBe(3);
    const report = await syncOnce(pc, t, clock);
    expect(report.received).toBe(250);
    expect(await pc.list()).toHaveLength(250);
  });

  it("an entry without series or authors replaces one that had them", async () => {
    await phone.add(dune);
    const t = server.transport();
    await syncOnce(phone, t, clock);
    await syncOnce(pc, t, clock);
    await sleep();
    const id = (await phone.list())[0].id;
    await phone.update(id, { seriesName: "" });
    await syncOnce(phone, t, clock);
    await syncOnce(pc, t, clock);
    expect((await pc.list())[0].seriesName).toBeUndefined();
  });

  it("a device that switches to another library starts again from zero (it used to receive nothing)", async () => {
    // Le PC a d'abord synchronisé sa propre bibliothèque (identité « pc ») : sa position de reprise est élevée,
    // car la séquence du serveur est commune à tous ses utilisateurs.
    const own = new FakeServer();
    own.seq = 50;
    await pc.add(hyperion);
    await useSyncIdentity(pc, "pc");
    await syncOnce(pc, own.transport(), clock);

    // Le téléphone a rempli sa bibliothèque : ses fiches ont des numéros bas.
    await phone.add(dune);
    const joined = new FakeServer();
    await syncOnce(phone, joined.transport(), clock);

    // Le PC rejoint la bibliothèque du téléphone.
    await useSyncIdentity(pc, "phone");
    const report = await syncOnce(pc, joined.transport(), clock);
    expect(report.received).toBe(1);
    expect((await pc.list()).map(b => b.title).sort()).toEqual(["Dune", "Hypérion"]);
    // et la bibliothèque du PC est elle aussi partagée désormais
    await syncOnce(phone, joined.transport(), clock);
    expect((await phone.list()).map(b => b.title).sort()).toEqual(["Dune", "Hypérion"]);

    // Même identité : rien ne change.
    await useSyncIdentity(pc, "phone");
    expect((await syncOnce(pc, joined.transport(), clock)).received).toBe(0);
  });

  it("never lets an older version overwrite a newer local one, and lets a newer one win", async () => {
    await phone.add(dune);
    const [local] = await phone.list();
    const at = (offsetSeconds: number) => new Date(new Date(local.updatedAt).getTime() + offsetSeconds * 1000).toISOString();

    // plus ancienne : ignorée, y compris une suppression plus ancienne
    expect(await phone.applyRemote([{ ...local, rating: 1, updatedAt: at(-5) }])).toMatchObject({ entries: 0 });
    expect(await phone.applyRemote([{ ...local, deletedAt: at(-5), updatedAt: at(-5) }])).toMatchObject({ entries: 0 });
    // égale : rien à faire
    expect(await phone.applyRemote([{ ...local, rating: 2 }])).toMatchObject({ entries: 0 });
    expect((await phone.list())[0]).toMatchObject({ rating: undefined, status: "TO_READ" });

    // plus récente : appliquée
    expect(await phone.applyRemote([{ ...local, rating: 4, updatedAt: at(5) }])).toMatchObject({ entries: 1 });
    expect((await phone.list())[0].rating).toBe(4);

    // une suppression plus récente l'emporte, puis une version encore plus récente la ressuscite
    await phone.applyRemote([{ ...local, deletedAt: at(10), updatedAt: at(10) }]);
    expect(await phone.list()).toHaveLength(0);
    await phone.applyRemote([{ ...local, rating: 3, updatedAt: at(20) }]);
    expect((await phone.list())[0].rating).toBe(3);
  });

  it("a restore on one device brings the books back on the other, and a delete-all is undone everywhere", async () => {
    await phone.add(dune);
    await phone.add(hyperion);
    const t = server.transport();
    await syncOnce(phone, t, clock);
    await syncOnce(pc, t, clock);

    await sleep();
    expect(await pc.removeAll()).toBe(2);
    await syncOnce(pc, t, clock);
    await syncOnce(phone, t, clock);
    expect(await phone.list()).toHaveLength(0);

    await sleep();
    const deleted = await phone.listRecentlyDeleted("2000-01-01T00:00:00.000Z");
    await phone.restore(deleted.map(entry => entry.id));
    await syncOnce(phone, t, clock);
    await syncOnce(pc, t, clock);
    expect((await pc.list()).map(b => b.title).sort()).toEqual(["Dune", "Hypérion"]);
    expect((await pc.list()).find(b => b.title === "Dune")).toMatchObject({ authors: ["Frank Herbert"], seriesName: "Cycle de Dune" });
  });
});
