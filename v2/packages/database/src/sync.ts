import type { SqliteLibraryRepository } from "./library-repository";
import type { SyncEntry, SyncFollowedAuthor } from "./types";

/*
 * Synchronisation entre appareils. L'unité échangée est la fiche de bibliothèque entière (un livre avec
 * son état de lecture), identifiée par son id : l'appareil qui l'a modifiée en dernier l'emporte,
 * fiche par fiche. Les suppressions sont des fiches marquées `deletedAt`, donc elles se propagent aussi.
 * Les doublons créés séparément sur deux appareils (ids différents) sont fusionnés par l'application
 * après la synchronisation, comme pour n'importe quel doublon.
 */

export interface SyncPayload { entries: SyncEntry[]; followed: SyncFollowedAuthor[] }

export interface SyncPage extends SyncPayload {
  /** Position à reprendre au prochain appel. */
  cursor: number;
  hasMore: boolean;
}

/** Ce que le serveur (ou son double de test) sait faire. */
export interface SyncTransport {
  push(payload: SyncPayload): Promise<void>;
  pull(since: number, limit: number): Promise<SyncPage>;
}

export interface SyncReport {
  pushed: number;
  /** Fiches reçues qui ont réellement modifié cet appareil. */
  received: number;
  followedReceived: number;
}

const PUSH_CHUNK = 100;
const PULL_PAGE = 500;
const KEY_PUSHED_AT = "sync.pushedAt";
const KEY_CURSOR = "sync.cursor";

/** Envoie ce qui a changé ici, puis reçoit ce qui a changé ailleurs. Rien n'est perdu si l'appel échoue : il suffit de recommencer. */
export async function syncOnce(
  repo: SqliteLibraryRepository, transport: SyncTransport, now: () => string = () => new Date().toISOString()
): Promise<SyncReport> {
  const startedAt = now();
  const since = (await repo.getSyncState(KEY_PUSHED_AT)) ?? "";
  const entries = await repo.changesSince(since);
  const followed = await repo.followedChangesSince(since);

  const chunks: SyncPayload[] = [];
  for (let start = 0; start < entries.length; start += PUSH_CHUNK) {
    chunks.push({ entries: entries.slice(start, start + PUSH_CHUNK), followed: start === 0 ? followed : [] });
  }
  if (!chunks.length && followed.length) chunks.push({ entries: [], followed });
  for (const chunk of chunks) await transport.push(chunk);
  // La prochaine fois on repart de cet instant (inclus) : renvoyer une fiche déjà envoyée est sans effet, le serveur ignore une version égale.
  await repo.setSyncState(KEY_PUSHED_AT, startedAt);

  let cursor = Number((await repo.getSyncState(KEY_CURSOR)) ?? 0);
  let received = 0;
  let followedReceived = 0;
  while (true) {
    const page = await transport.pull(cursor, PULL_PAGE);
    const applied = await repo.applyRemote(page.entries, page.followed);
    received += applied.entries;
    followedReceived += applied.followed;
    cursor = page.cursor;
    await repo.setSyncState(KEY_CURSOR, String(cursor));
    if (!page.hasMore) break;
  }
  return { pushed: entries.length, received, followedReceived };
}
