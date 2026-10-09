import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Pool } from "pg";
import { SCHEMA } from "./schema.js";

/*
 * Serveur de synchronisation de Tsundoku : une base PostgreSQL, un jeton, trois routes.
 *   GET  /v1/ping            vérifie l'adresse et le jeton
 *   POST /v1/push            { entries, followed } : enregistre ce qui est plus récent que la version connue
 *   GET  /v1/pull?since&limit  les changements après la position `since`
 * Les fiches sont stockées telles quelles (JSON) : le serveur ne connaît que leur id et leur date de version.
 * Une seule personne l'utilise : pas de comptes, un jeton secret partagé par ses appareils.
 */

const MAX_BODY = 20 * 1024 * 1024; // des jaquettes personnelles en data: peuvent être lourdes
const MAX_PULL = 1000;
const MAX_PUSH_ITEMS = 2000;

interface Entry { id: string; updatedAt: string }
interface Followed { authorKey: string; updatedAt: string }

export class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isEntry = (value: unknown): value is Entry =>
  isObject(value) && typeof value.id === "string" && value.id.length > 0 && value.id.length <= 100 && typeof value.updatedAt === "string" && value.updatedAt.length > 0;
const isFollowed = (value: unknown): value is Followed =>
  isObject(value) && typeof value.authorKey === "string" && value.authorKey.length > 0 && typeof value.updatedAt === "string" && value.updatedAt.length > 0;

/** Comparaison en temps constant, quelle que soit la longueur du jeton fourni. */
function sameToken(given: string, expected: string): boolean {
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, "Requête trop volumineuse.");
    chunks.push(chunk as Buffer);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new HttpError(400, "JSON invalide."); }
}

export async function prepareDatabase(pool: Pool): Promise<void> {
  await pool.query(SCHEMA);
}

export async function push(pool: Pool, body: unknown): Promise<{ accepted: number }> {
  if (!isObject(body)) throw new HttpError(400, "Corps attendu : { entries, followed }.");
  const entries = body.entries ?? [];
  const followed = body.followed ?? [];
  if (!Array.isArray(entries) || !Array.isArray(followed) || !entries.every(isEntry) || !followed.every(isFollowed)) {
    throw new HttpError(400, "Fiches invalides.");
  }
  if (entries.length + followed.length > MAX_PUSH_ITEMS) throw new HttpError(413, "Trop de fiches d'un coup.");

  const client = await pool.connect();
  let accepted = 0;
  try {
    await client.query("BEGIN");
    // Un seul envoi à la fois : l'ordre des numéros de séquence est alors celui de la validation.
    await client.query("SELECT pg_advisory_xact_lock(42)");
    for (const entry of entries) {
      const result = await client.query(
        `INSERT INTO entries(id, doc, updated_at) VALUES($1, $2, $3)
         ON CONFLICT (id) DO UPDATE SET doc = EXCLUDED.doc, updated_at = EXCLUDED.updated_at, seq = nextval('sync_seq')
         WHERE entries.updated_at < EXCLUDED.updated_at`,
        [entry.id, JSON.stringify(entry), entry.updatedAt]
      );
      accepted += result.rowCount ?? 0;
    }
    for (const author of followed) {
      const result = await client.query(
        `INSERT INTO followed(author_key, doc, updated_at) VALUES($1, $2, $3)
         ON CONFLICT (author_key) DO UPDATE SET doc = EXCLUDED.doc, updated_at = EXCLUDED.updated_at, seq = nextval('sync_seq')
         WHERE followed.updated_at < EXCLUDED.updated_at`,
        [author.authorKey, JSON.stringify(author), author.updatedAt]
      );
      accepted += result.rowCount ?? 0;
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  return { accepted };
}

export async function pull(pool: Pool, since: number, limit: number) {
  const size = Math.min(Math.max(1, limit), MAX_PULL);
  const { rows } = await pool.query<{ kind: "e" | "f"; doc: unknown; seq: string }>(
    `SELECT * FROM (
       SELECT 'e' AS kind, doc, seq FROM entries WHERE seq > $1
       UNION ALL
       SELECT 'f' AS kind, doc, seq FROM followed WHERE seq > $1
     ) changes ORDER BY seq LIMIT $2`,
    [since, size + 1]
  );
  const page = rows.slice(0, size);
  return {
    entries: page.filter(row => row.kind === "e").map(row => row.doc),
    followed: page.filter(row => row.kind === "f").map(row => row.doc),
    // bigint arrive en texte ; un numéro de séquence reste très en dessous de 2^53
    cursor: page.length ? Number(page[page.length - 1].seq) : since,
    hasMore: rows.length > size
  };
}

function send(response: ServerResponse, status: number, body: unknown) {
  const text = JSON.stringify(body);
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(text) });
  response.end(text);
}

/** L'application WebView appelle depuis une autre origine : le jeton, pas l'origine, protège le serveur. */
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Max-Age": "86400"
};

export function createApp(pool: Pool, token: string): Server {
  if (token.length < 32) throw new Error("Le jeton doit faire au moins 32 caractères.");
  return createServer(async (request, response) => {
    for (const [name, value] of Object.entries(CORS)) response.setHeader(name, value);
    try {
      if (request.method === "OPTIONS") { response.writeHead(204); response.end(); return; }
      const header = request.headers.authorization ?? "";
      if (!header.startsWith("Bearer ") || !sameToken(header.slice(7), token)) throw new HttpError(401, "Jeton invalide.");

      const url = new URL(request.url ?? "/", "http://localhost");
      if (request.method === "GET" && url.pathname === "/v1/ping") return send(response, 200, { ok: true });
      if (request.method === "POST" && url.pathname === "/v1/push") return send(response, 200, await push(pool, await readJson(request)));
      if (request.method === "GET" && url.pathname === "/v1/pull") {
        const since = Number(url.searchParams.get("since") ?? 0);
        const limit = Number(url.searchParams.get("limit") ?? 500);
        if (!Number.isFinite(since) || since < 0 || !Number.isFinite(limit)) throw new HttpError(400, "Paramètres invalides.");
        return send(response, 200, await pull(pool, since, limit));
      }
      throw new HttpError(404, "Route inconnue.");
    } catch (error) {
      if (error instanceof HttpError) return send(response, error.status, { error: error.message });
      console.error("Erreur serveur :", error);
      send(response, 500, { error: "Erreur du serveur." });
    }
  });
}
