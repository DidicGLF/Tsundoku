import type { AddressInfo } from "node:net";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHttpTransport, runMigrations, SqliteLibraryRepository, syncOnce, SyncServerError } from "@tsundoku/database";
import { createApp, prepareDatabase } from "../src/app";
import { createTestAdapter } from "../../database/test/sqljs-adapter";

/*
 * Test de bout en bout contre un vrai PostgreSQL : il ne tourne que si SYNC_TEST_DATABASE_URL est défini
 * (voir test/run-with-postgres.sh qui en crée un temporaire).
 */
const databaseUrl = process.env.SYNC_TEST_DATABASE_URL;
const TOKEN = "t".repeat(40);

describe.skipIf(!databaseUrl)("serveur de synchronisation (PostgreSQL réel)", () => {
  let pool: pg.Pool;
  let baseUrl: string;
  let close: () => Promise<void>;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: databaseUrl });
    await prepareDatabase(pool);
    const server = createApp(pool, TOKEN);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () => new Promise(resolve => server.close(() => resolve()));
  });
  afterAll(async () => { await close(); await pool.end(); });
  beforeEach(async () => { await pool.query("TRUNCATE entries, followed"); });

  async function device() {
    const db = await createTestAdapter();
    await runMigrations(db);
    return new SqliteLibraryRepository(db);
  }
  const sleep = () => new Promise(resolve => setTimeout(resolve, 5));

  it("refuses a missing or wrong token, accepts the right one", async () => {
    expect((await fetch(`${baseUrl}/v1/ping`)).status).toBe(401);
    expect((await fetch(`${baseUrl}/v1/ping`, { headers: { Authorization: "Bearer nope" } })).status).toBe(401);
    await expect(createHttpTransport(baseUrl, TOKEN).ping()).resolves.toBeUndefined();
    await expect(createHttpTransport(baseUrl, "x".repeat(40)).ping()).rejects.toBeInstanceOf(SyncServerError);
  });

  it("answers CORS preflight requests (the app runs in a WebView)", async () => {
    const response = await fetch(`${baseUrl}/v1/push`, { method: "OPTIONS" });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-headers")).toContain("Authorization");
  });

  it("rejects malformed pushes and unknown routes", async () => {
    const headers = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };
    expect((await fetch(`${baseUrl}/v1/push`, { method: "POST", headers, body: "pas du json" })).status).toBe(400);
    expect((await fetch(`${baseUrl}/v1/push`, { method: "POST", headers, body: JSON.stringify({ entries: [{ id: 1 }] }) })).status).toBe(400);
    expect((await fetch(`${baseUrl}/v1/nope`, { headers })).status).toBe(404);
    expect((await fetch(`${baseUrl}/v1/pull?since=abc`, { headers })).status).toBe(400);
  });

  it("keeps the most recent version on the server whatever the push order", async () => {
    const transport = createHttpTransport(baseUrl, TOKEN);
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
    const transport = createHttpTransport(baseUrl, TOKEN);

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
    const transport = createHttpTransport(baseUrl, TOKEN);
    await syncOnce(phone, transport);
    expect((await syncOnce(pc, transport)).received).toBe(700);
  });
});
