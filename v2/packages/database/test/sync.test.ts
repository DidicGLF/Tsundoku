import { beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../src/migrations";
import { SqliteLibraryRepository } from "../src/library-repository";
import { syncOnce, type SyncPage, type SyncPayload, type SyncTransport } from "../src/sync";
import type { NewLibraryBook, SyncEntry, SyncFollowedAuthor } from "../src/types";
import { createTestAdapter } from "./sqljs-adapter";

/** Double du serveur : même règle que le vrai (la version la plus récente gagne, un numéro de séquence par changement accepté). */
class FakeServer {
  seq = 0;
  entries = new Map<string, { seq: number; entry: SyncEntry }>();
  followed = new Map<string, { seq: number; author: SyncFollowedAuthor }>();
  pushes = 0;

  transport(): SyncTransport {
    return {
      push: async (payload: SyncPayload) => {
        this.pushes++;
        for (const entry of payload.entries) {
          const current = this.entries.get(entry.id);
          if (!current || current.entry.updatedAt < entry.updatedAt) this.entries.set(entry.id, { seq: ++this.seq, entry });
        }
        for (const author of payload.followed) {
          const current = this.followed.get(author.authorKey);
          if (!current || current.author.updatedAt < author.updatedAt) this.followed.set(author.authorKey, { seq: ++this.seq, author });
        }
      },
      pull: async (since: number, limit: number): Promise<SyncPage> => {
        const rows = [
          ...[...this.entries.values()].filter(row => row.seq > since).map(row => ({ seq: row.seq, entry: row.entry })),
          ...[...this.followed.values()].filter(row => row.seq > since).map(row => ({ seq: row.seq, author: row.author }))
        ].sort((a, b) => a.seq - b.seq);
        const page = rows.slice(0, limit);
        return {
          entries: page.flatMap(row => ("entry" in row ? [row.entry] : [])),
          followed: page.flatMap(row => ("author" in row ? [row.author] : [])),
          cursor: page.length ? page[page.length - 1].seq : since,
          hasMore: rows.length > limit
        };
      }
    };
  }
}

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
});
