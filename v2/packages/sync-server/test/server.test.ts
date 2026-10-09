import type { AddressInfo } from "node:net";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHttpTransport, runMigrations, SqliteLibraryRepository, syncOnce, SyncServerError } from "../../database/src/index";
import { createApp, DEFAULT_LIMITS, prepareDatabase, type Limits } from "../src/app";
import { createTestAdapter } from "../../database/test/sqljs-adapter";

/*
 * Test de bout en bout contre un vrai PostgreSQL : il ne tourne que si SYNC_TEST_DATABASE_URL est défini
 * (voir test/run-with-postgres.sh qui en crée un temporaire).
 */
const databaseUrl = process.env.SYNC_TEST_DATABASE_URL;
const KEY = "k".repeat(43);
const OTHER_KEY = "o".repeat(43);

describe.skipIf(!databaseUrl)("serveur de synchronisation (PostgreSQL réel)", () => {
  let pool: pg.Pool;
  let baseUrl: string;
  let closers: Array<() => Promise<void>> = [];

  async function start(limits: Partial<Limits> = {}): Promise<string> {
    const server = createApp(pool, { ...DEFAULT_LIMITS, ...limits });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    closers.push(() => new Promise(resolve => server.close(() => resolve())));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: databaseUrl });
    await prepareDatabase(pool);
  });
  afterAll(async () => { await pool.end(); });
  beforeEach(async () => {
    await pool.query("TRUNCATE users CASCADE");
    baseUrl = await start();
  });
  afterEach(async () => { await Promise.all(closers.map(close => close())); closers = []; });

  async function device() {
    const db = await createTestAdapter();
    await runMigrations(db);
    return new SqliteLibraryRepository(db);
  }
  const sleep = () => new Promise(resolve => setTimeout(resolve, 5));

  it("refuses a missing or malformed key, accepts a well-formed one", async () => {
    expect((await fetch(`${baseUrl}/v1/ping`)).status).toBe(401);
    expect((await fetch(`${baseUrl}/v1/ping`, { headers: { Authorization: "Bearer trop-court" } })).status).toBe(401);
    await expect(createHttpTransport(baseUrl, KEY).ping()).resolves.toBeUndefined();
    await expect(createHttpTransport(baseUrl, "x").ping()).rejects.toBeInstanceOf(SyncServerError);
  });

  it("answers CORS preflight requests (the app runs in a WebView)", async () => {
    const response = await fetch(`${baseUrl}/v1/push`, { method: "OPTIONS" });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-headers")).toContain("Authorization");
  });

  it("rejects malformed pushes and unknown routes", async () => {
    const headers = { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
    expect((await fetch(`${baseUrl}/v1/push`, { method: "POST", headers, body: "pas du json" })).status).toBe(400);
    expect((await fetch(`${baseUrl}/v1/push`, { method: "POST", headers, body: JSON.stringify({ entries: [{ id: 1 }] }) })).status).toBe(400);
    expect((await fetch(`${baseUrl}/v1/nope`, { headers })).status).toBe(404);
    expect((await fetch(`${baseUrl}/v1/pull?since=abc`, { headers })).status).toBe(400);
  });

  it("keeps the most recent version on the server whatever the push order", async () => {
    const transport = createHttpTransport(baseUrl, KEY);
    const doc = (rating: number, updatedAt: string) => ({ id: "e1", updatedAt, rating });
    await transport.push({ entries: [doc(5, "2026-02-01T00:00:00.000Z")] as never, followed: [] });
    await transport.push({ entries: [doc(1, "2026-01-01T00:00:00.000Z")] as never, followed: [] }); // plus ancien : ignoré
    const page = await transport.pull(0, 100);
    expect(page.entries).toHaveLength(1);
    expect((page.entries[0] as unknown as { rating: number }).rating).toBe(5);
  });

  it("synchronises two devices end to end", async () => {
    const phone = await device();
    const pc = await device();
    await phone.add({ source: "bnf", sourceId: "1", title: "Dune", authors: ["Frank Herbert"], isbn13: "9780441172719", seriesName: "Dune", seriesVolume: 1 });
    await phone.add({ source: "bnf", sourceId: "2", title: "Hypérion", authors: ["Dan Simmons"], isbn13: "9782070415236", owned: false });
    await phone.upsertFollowedAuthor("frank herbert", "Frank Herbert", "2026-02-01T00:00:00Z");
    const transport = createHttpTransport(baseUrl, KEY);

    expect((await syncOnce(phone, transport)).pushed).toBe(2);
    const received = await syncOnce(pc, transport);
    expect(received).toMatchObject({ received: 2, followedReceived: 1 });
    expect((await pc.list()).map(b => b.title).sort()).toEqual(["Dune", "Hypérion"]);

    await sleep();
    const dune = (await pc.list()).find(b => b.title === "Dune")!;
    await pc.update(dune.id, { status: "READ", rating: 5 });
    await pc.remove((await pc.list()).find(b => b.title === "Hypérion")!.id);
    await syncOnce(pc, transport);
    await syncOnce(phone, transport);
    const onPhone = await phone.list();
    expect(onPhone).toHaveLength(1);
    expect(onPhone[0]).toMatchObject({ title: "Dune", status: "READ", rating: 5 });
  });

  it("pages through a large library", async () => {
    const phone = await device();
    const pc = await device();
    await phone.addMany(Array.from({ length: 700 }, (_, i) => ({
      source: "bnf" as const, sourceId: `s${i}`, title: `Livre ${i}`, authors: ["Auteur"], isbn13: `978100000${String(i).padStart(4, "0")}`
    })));
    const transport = createHttpTransport(baseUrl, KEY);
    await syncOnce(phone, transport);
    expect((await syncOnce(pc, transport)).received).toBe(700);
  });

  it("keeps each user's library private", async () => {
    const mine = await device();
    const theirs = await device();
    await mine.add({ source: "bnf", sourceId: "1", title: "Mon livre", authors: ["A"], isbn13: "9780441172719" });
    await theirs.add({ source: "bnf", sourceId: "2", title: "Son livre", authors: ["B"], isbn13: "9782070415236" });
    await syncOnce(mine, createHttpTransport(baseUrl, KEY));
    await syncOnce(theirs, createHttpTransport(baseUrl, OTHER_KEY));

    const fresh = await device();
    await syncOnce(fresh, createHttpTransport(baseUrl, KEY));
    expect((await fresh.list()).map(b => b.title)).toEqual(["Mon livre"]);
    const { rows } = await pool.query("SELECT count(*) AS n FROM users");
    expect(Number(rows[0].n)).toBe(2);
  });

  it("does not store the key itself", async () => {
    const phone = await device();
    await phone.add({ source: "bnf", sourceId: "1", title: "Dune", authors: ["A"], isbn13: "9780441172719" });
    await syncOnce(phone, createHttpTransport(baseUrl, KEY));
    const { rows } = await pool.query("SELECT user_id FROM users");
    expect(rows[0].user_id).not.toContain(KEY);
    expect(rows[0].user_id).toHaveLength(64);
  });

  it("erases everything of a user on request, and only theirs", async () => {
    const mine = await device();
    const theirs = await device();
    await mine.add({ source: "bnf", sourceId: "1", title: "Mon livre", authors: ["A"], isbn13: "9780441172719" });
    await theirs.add({ source: "bnf", sourceId: "2", title: "Son livre", authors: ["B"], isbn13: "9782070415236" });
    await syncOnce(mine, createHttpTransport(baseUrl, KEY));
    await syncOnce(theirs, createHttpTransport(baseUrl, OTHER_KEY));

    await createHttpTransport(baseUrl, KEY).deleteAccount();
    const { rows } = await pool.query("SELECT (SELECT count(*) FROM entries WHERE user_id <> '') AS entries, (SELECT count(*) FROM users) AS users");
    expect(Number(rows[0].entries)).toBe(1);
    expect(Number(rows[0].users)).toBe(1);
    const fresh = await device();
    await syncOnce(fresh, createHttpTransport(baseUrl, OTHER_KEY));
    expect((await fresh.list()).map(b => b.title)).toEqual(["Son livre"]);
  });

  it("caps the number of users and of new users per hour", async () => {
    const capped = await start({ maxUsers: 1 });
    const first = await device();
    await first.add({ source: "bnf", sourceId: "1", title: "A", authors: ["A"], isbn13: "9780441172719" });
    await syncOnce(first, createHttpTransport(capped, KEY));
    const second = await device();
    await second.add({ source: "bnf", sourceId: "2", title: "B", authors: ["B"], isbn13: "9782070415236" });
    await expect(syncOnce(second, createHttpTransport(capped, OTHER_KEY))).rejects.toThrow(/nouveaux utilisateurs/);

    const slow = await start({ newUsersPerHour: 1, maxUsers: 100 });
    const third = await device();
    await third.add({ source: "bnf", sourceId: "3", title: "C", authors: ["C"], isbn13: "9782070415236" });
    await syncOnce(third, createHttpTransport(slow, "a".repeat(43)));
    const fourth = await device();
    await fourth.add({ source: "bnf", sourceId: "4", title: "D", authors: ["D"], isbn13: "9780441172719" });
    await expect(syncOnce(fourth, createHttpTransport(slow, "b".repeat(43)))).rejects.toThrow(/inscriptions/);
  });

  it("limits the requests per minute and the size of a library", async () => {
    const strict = await start({ requestsPerMinute: 3, maxEntriesPerUser: 2 });
    const transport = createHttpTransport(strict, KEY);
    await transport.ping(); await transport.ping(); await transport.ping();
    await expect(transport.ping()).rejects.toThrow(/Trop de requêtes/);

    const roomy = await start({ maxEntriesPerUser: 2 });
    const phone = await device();
    await phone.addMany(Array.from({ length: 3 }, (_, i) => ({ source: "bnf" as const, sourceId: `s${i}`, title: `L${i}`, authors: ["A"], isbn13: `97800000000${i}0` })));
    await expect(syncOnce(phone, createHttpTransport(roomy, "c".repeat(43)))).rejects.toThrow(/volumineuse/);
  });

  it("sets the first single-token tables aside instead of failing on them", async () => {
    await pool.query("DROP TABLE IF EXISTS followed, entries, users, entries_v1, followed_v1 CASCADE");
    await pool.query(`CREATE TABLE entries (id text PRIMARY KEY, doc jsonb NOT NULL, updated_at text NOT NULL, seq bigint NOT NULL DEFAULT nextval('sync_seq'))`.replace("nextval('sync_seq')", "0"));
    await pool.query(`CREATE INDEX entries_seq ON entries(seq)`);
    await pool.query(`CREATE TABLE followed (author_key text PRIMARY KEY, doc jsonb NOT NULL, updated_at text NOT NULL, seq bigint NOT NULL DEFAULT 0)`);
    await pool.query(`CREATE INDEX followed_seq ON followed(seq)`);
    await pool.query(`INSERT INTO entries(id, doc, updated_at) VALUES('x', '{}', 'now')`);
    await prepareDatabase(pool);
    expect(Number((await pool.query("SELECT count(*) AS n FROM entries_v1")).rows[0].n)).toBe(1);
    const phone = await device();
    await phone.add({ source: "bnf", sourceId: "1", title: "Dune", authors: ["A"], isbn13: "9780441172719" });
    await expect(syncOnce(phone, createHttpTransport(baseUrl, KEY))).resolves.toMatchObject({ pushed: 1 });
  });
});
