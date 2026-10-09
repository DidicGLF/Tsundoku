import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Pool, PoolClient } from "pg";
import { LEGACY_RENAME, SCHEMA } from "./schema.js";

/*
 * Serveur de synchronisation de Tsundoku : une base PostgreSQL, quelques routes.
 *   GET    /v1/ping              vérifie l'adresse et le format de la clé
 *   POST   /v1/push              { entries, followed } : enregistre ce qui est plus récent que la version connue
 *   GET    /v1/pull?since&limit  les changements après la position `since`
 *   DELETE /v1/account           efface toutes les données de cet utilisateur
 *   PUT    /v1/pair/:id          dépose une clé chiffrée par un code de liaison (quelques minutes, un seul à la fois par utilisateur)
 *   POST   /v1/pair/claim        { id } : récupère cette clé chiffrée, une seule fois (sans clé : c'est l'autre appareil)
 * Les fiches sont stockées telles quelles (JSON) : le serveur ne connaît que leur id et leur date de version.
 * Pas de compte ni de mot de passe : chaque application génère une clé secrète aléatoire (en-tête Bearer).
 * L'utilisateur est l'empreinte de cette clé, créé au premier envoi ; la clé elle-même n'est jamais stockée.
 */

const MAX_BODY = 20 * 1024 * 1024; // des jaquettes personnelles en data: peuvent être lourdes
const MAX_PULL = 1000;
const MAX_PUSH_ITEMS = 2000;
const MIN_KEY_LENGTH = 32;
const MAX_KEY_LENGTH = 200;

export interface Limits {
  /** Nombre maximal d'utilisateurs (inscription ouverte : garde-fou contre une inondation). */
  maxUsers: number;
  /** Fiches maximum par utilisateur. */
  maxEntriesPerUser: number;
  /** Requêtes par minute et par utilisateur. */
  requestsPerMinute: number;
  /** Nouveaux utilisateurs acceptés par heure, tous confondus. */
  newUsersPerHour: number;
  /** Validité d'un code de liaison. */
  pairingTtlSeconds: number;
  /** Demandes de code de liaison par minute, tous confondus (l'identifiant d'un code ne se devine pas : c'est un garde-fou de charge). */
  claimsPerMinute: number;
}

export const DEFAULT_LIMITS: Limits = { maxUsers: 200, maxEntriesPerUser: 20000, requestsPerMinute: 120, newUsersPerHour: 20, pairingTtlSeconds: 300, claimsPerMinute: 300 };

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

/** Identifiant stable d'un utilisateur : l'empreinte de sa clé. */
export function userIdOf(key: string): string {
  return createHash("sha256").update(key).digest("hex");
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
  await pool.query(LEGACY_RENAME);
  await pool.query(SCHEMA);
}

export async function push(pool: Pool, userId: string, body: unknown, limits: Limits = DEFAULT_LIMITS, newUsers?: { allow(): boolean }): Promise<{ accepted: number }> {
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
    await registerUser(client, userId, limits, newUsers);
    for (const entry of entries) {
      const result = await client.query(
        `INSERT INTO entries(user_id, id, doc, updated_at) VALUES($1, $2, $3, $4)
         ON CONFLICT (user_id, id) DO UPDATE SET doc = EXCLUDED.doc, updated_at = EXCLUDED.updated_at, seq = nextval('sync_seq')
         WHERE entries.updated_at < EXCLUDED.updated_at`,
        [userId, entry.id, JSON.stringify(entry), entry.updatedAt]
      );
      accepted += result.rowCount ?? 0;
    }
    for (const author of followed) {
      const result = await client.query(
        `INSERT INTO followed(user_id, author_key, doc, updated_at) VALUES($1, $2, $3, $4)
         ON CONFLICT (user_id, author_key) DO UPDATE SET doc = EXCLUDED.doc, updated_at = EXCLUDED.updated_at, seq = nextval('sync_seq')
         WHERE followed.updated_at < EXCLUDED.updated_at`,
        [userId, author.authorKey, JSON.stringify(author), author.updatedAt]
      );
      accepted += result.rowCount ?? 0;
    }
    const { rows } = await client.query<{ n: string }>("SELECT count(*) AS n FROM entries WHERE user_id = $1", [userId]);
    if (Number(rows[0].n) > limits.maxEntriesPerUser) throw new HttpError(413, "Bibliothèque trop volumineuse pour ce serveur.");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  return { accepted };
}

/** Crée l'utilisateur au premier envoi, dans les limites de l'inscription ouverte. */
async function registerUser(client: PoolClient, userId: string, limits: Limits, newUsers?: { allow(): boolean }): Promise<void> {
  const known = await client.query("UPDATE users SET last_seen = now() WHERE user_id = $1", [userId]);
  if (known.rowCount) return;
  if (newUsers && !newUsers.allow()) throw new HttpError(429, "Trop de nouvelles inscriptions, réessaie plus tard.");
  const { rows } = await client.query<{ n: string }>("SELECT count(*) AS n FROM users");
  if (Number(rows[0].n) >= limits.maxUsers) throw new HttpError(503, "Ce serveur n'accepte plus de nouveaux utilisateurs.");
  await client.query("INSERT INTO users(user_id) VALUES($1)", [userId]);
}

const MAX_PENDING_PAIRINGS = 1000;
const MAX_PAYLOAD = 4096;

/** Dépose un code de liaison ; le précédent de cet utilisateur est remplacé. */
export async function offerPairing(pool: Pool, userId: string, id: string, payload: unknown, ttlSeconds: number): Promise<void> {
  if (!/^[0-9a-f]{32,128}$/.test(id) || typeof payload !== "string" || payload.length === 0 || payload.length > MAX_PAYLOAD) {
    throw new HttpError(400, "Code de liaison invalide.");
  }
  await pool.query("DELETE FROM pairings WHERE expires_at < now()");
  const { rows } = await pool.query<{ n: string }>("SELECT count(*) AS n FROM pairings");
  if (Number(rows[0].n) >= MAX_PENDING_PAIRINGS) throw new HttpError(503, "Trop de liaisons en cours, réessaie dans quelques minutes.");
  await pool.query("DELETE FROM pairings WHERE user_id = $1", [userId]);
  await pool.query(
    "INSERT INTO pairings(id, user_id, payload, expires_at) VALUES($1, $2, $3, now() + make_interval(secs => $4))",
    [id, userId, payload, ttlSeconds]
  );
}

/** Remet le paquet chiffré et le supprime : un code ne sert qu'une fois. */
export async function claimPairing(pool: Pool, id: unknown): Promise<string> {
  if (typeof id !== "string" || !/^[0-9a-f]{32,128}$/.test(id)) throw new HttpError(404, "Code inconnu ou expiré.");
  const { rows } = await pool.query<{ payload: string }>("DELETE FROM pairings WHERE id = $1 AND expires_at >= now() RETURNING payload", [id]);
  if (!rows[0]) throw new HttpError(404, "Code inconnu ou expiré.");
  return rows[0].payload;
}

/** Efface toutes les données d'un utilisateur (droit à l'effacement). */
export async function deleteAccount(pool: Pool, userId: string): Promise<void> {
  await pool.query("DELETE FROM users WHERE user_id = $1", [userId]);
}

export async function pull(pool: Pool, userId: string, since: number, limit: number) {
  const size = Math.min(Math.max(1, limit), MAX_PULL);
  const { rows } = await pool.query<{ kind: "e" | "f"; doc: unknown; seq: string }>(
    `SELECT * FROM (
       SELECT 'e' AS kind, doc, seq FROM entries WHERE user_id = $3 AND seq > $1
       UNION ALL
       SELECT 'f' AS kind, doc, seq FROM followed WHERE user_id = $3 AND seq > $1
     ) changes ORDER BY seq LIMIT $2`,
    [since, size + 1, userId]
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
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Max-Age": "86400"
};

/** Compteur glissant : au plus `max` événements par `windowMs`. */
function slidingLimit(max: number, windowMs: number, now: () => number = Date.now) {
  const stamps: number[] = [];
  return {
    allow(): boolean {
      const t = now();
      while (stamps.length && stamps[0] <= t - windowMs) stamps.shift();
      if (stamps.length >= max) return false;
      stamps.push(t);
      return true;
    }
  };
}

export function createApp(pool: Pool, limits: Limits = DEFAULT_LIMITS): Server {
  const newUsers = slidingLimit(limits.newUsersPerHour, 3600 * 1000);
  const claims = slidingLimit(limits.claimsPerMinute, 60 * 1000);
  const perUser = new Map<string, ReturnType<typeof slidingLimit>>();

  function rateLimit(userId: string): void {
    let counter = perUser.get(userId);
    if (!counter) {
      if (perUser.size > 5000) perUser.clear(); // la mémoire reste bornée
      counter = slidingLimit(limits.requestsPerMinute, 60 * 1000);
      perUser.set(userId, counter);
    }
    if (!counter.allow()) throw new HttpError(429, "Trop de requêtes, réessaie dans une minute.");
  }

  return createServer(async (request, response) => {
    for (const [name, value] of Object.entries(CORS)) response.setHeader(name, value);
    try {
      if (request.method === "OPTIONS") { response.writeHead(204); response.end(); return; }
      const path = new URL(request.url ?? "/", "http://localhost").pathname;
      // Le nouvel appareil n'a pas encore de clé : cette route est la seule sans authentification.
      if (request.method === "POST" && path === "/v1/pair/claim") {
        if (!claims.allow()) throw new HttpError(429, "Trop de tentatives, réessaie dans une minute.");
        const body = await readJson(request);
        return send(response, 200, { payload: await claimPairing(pool, isObject(body) ? body.id : undefined) });
      }
      const header = request.headers.authorization ?? "";
      const key = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
      if (key.length < MIN_KEY_LENGTH || key.length > MAX_KEY_LENGTH) throw new HttpError(401, "Clé de synchronisation invalide.");
      const userId = userIdOf(key);
      rateLimit(userId);

      const url = new URL(request.url ?? "/", "http://localhost");
      if (request.method === "GET" && url.pathname === "/v1/ping") return send(response, 200, { ok: true });
      if (request.method === "POST" && url.pathname === "/v1/push") return send(response, 200, await push(pool, userId, await readJson(request), limits, newUsers));
      if (request.method === "GET" && url.pathname === "/v1/pull") {
        const since = Number(url.searchParams.get("since") ?? 0);
        const limit = Number(url.searchParams.get("limit") ?? 500);
        if (!Number.isFinite(since) || since < 0 || !Number.isFinite(limit)) throw new HttpError(400, "Paramètres invalides.");
        return send(response, 200, await pull(pool, userId, since, limit));
      }
      if (request.method === "PUT" && url.pathname.startsWith("/v1/pair/")) {
        const body = await readJson(request);
        await offerPairing(pool, userId, url.pathname.slice("/v1/pair/".length), isObject(body) ? body.payload : undefined, limits.pairingTtlSeconds);
        return send(response, 200, { ok: true, expiresInSeconds: limits.pairingTtlSeconds });
      }
      if (request.method === "DELETE" && url.pathname === "/v1/account") { await deleteAccount(pool, userId); return send(response, 200, { ok: true }); }
      throw new HttpError(404, "Route inconnue.");
    } catch (error) {
      if (error instanceof HttpError) return send(response, error.status, { error: error.message });
      console.error("Erreur serveur :", error);
      send(response, 500, { error: "Erreur du serveur." });
    }
  });
}
