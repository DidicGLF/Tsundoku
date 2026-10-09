import { vi } from "vitest";
import { runMigrations, SqliteLibraryRepository, syncOnce, type ReadingStatus, type SyncEntry, type SyncFollowedAuthor, type SyncTransport } from "@tsundoku/database";
import { createTestAdapter } from "../../../../packages/database/test/sqljs-adapter";
import { planDuplicateMerges } from "../../src/lib/library-view";

/*
 * Simulation de plusieurs appareils qui travaillent chacun de leur côté (ajouts, modifications, suppressions, doublons,
 * auteurs suivis), se synchronisent dans un ordre quelconque, puis convergent. Un modèle de référence calculé
 * indépendamment dit ce que chaque fiche doit valoir à la fin : la version la plus récemment écrite, partout.
 */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORKS = Array.from({ length: 10 }, (_, k) => ({
  source: "bnf" as const, sourceId: `work-${k}`, title: `Livre ${k}`, authors: [`Auteur ${"ABC"[k % 3]}`], isbn13: `97820700${String(k).padStart(5, "0")}`
}));
const AUTHORS = ["auteur a", "auteur b", "auteur c"];
const STATUSES: ReadingStatus[] = ["TO_READ", "READING", "READ"];

export interface FuzzOptions {
  seed: number;
  steps: number;
  /** Un transport par appareil (le dernier sert d'appareil « neuf » qui ne fait que synchroniser à la fin). */
  transports: SyncTransport[];
}

export interface FuzzResult { operations: Record<string, number>; liveEntries: number; tombstones: number }

/** Ce qu'on compare entre appareils : tout sauf l'identifiant de source, que l'application suffixe en cas de collision locale. */
const comparable = (entry: SyncEntry) => JSON.stringify({ ...entry, sourceId: undefined }, Object.keys({ ...entry, sourceId: 1 }).sort());

export async function runSyncFuzz({ seed, steps, transports }: FuzzOptions): Promise<FuzzResult> {
  const rng = mulberry32(seed);
  const pick = <T,>(items: T[]): T => items[Math.floor(rng() * items.length)];
  let clock = Date.UTC(2026, 0, 1);
  const tick = () => vi.setSystemTime((clock += 1000));
  tick();

  const devices: SqliteLibraryRepository[] = [];
  for (let i = 0; i < transports.length; i++) {
    const db = await createTestAdapter();
    await runMigrations(db);
    devices.push(new SqliteLibraryRepository(db));
  }
  const active = devices.length - 1; // le dernier est l'appareil neuf
  const operations: Record<string, number> = {};
  const count = (name: string) => { operations[name] = (operations[name] ?? 0) + 1; };

  // Modèle : pour chaque fiche, la dernière version écrite par n'importe quel appareil.
  const expected = new Map<string, SyncEntry>();
  const expectedFollowed = new Map<string, SyncFollowedAuthor>();
  const snapshot = async (repo: SqliteLibraryRepository) => {
    for (const entry of await repo.changesSince("")) {
      const known = expected.get(entry.id);
      if (!known || entry.updatedAt >= known.updatedAt) expected.set(entry.id, entry);
    }
    for (const author of await repo.followedChangesSince("")) {
      const known = expectedFollowed.get(author.authorKey);
      if (!known || author.updatedAt >= known.updatedAt) expectedFollowed.set(author.authorKey, author);
    }
  };

  /** Même fusion de doublons que l'application au démarrage et après chaque synchronisation. */
  const merge = async (repo: SqliteLibraryRepository) => {
    const merges = planDuplicateMerges(await repo.list());
    if (!merges.length) return;
    await repo.batch(async () => {
      for (const m of merges) {
        if (Object.keys(m.changes).length) await repo.update(m.keepId, m.changes);
        if (m.edition) await repo.setEdition(m.keepId, m.edition);
        for (const id of m.removeIds) await repo.remove(id);
      }
    });
    await snapshot(repo);
  };

  for (let step = 0; step < steps; step++) {
    const index = Math.floor(rng() * active);
    const repo = devices[index];
    const roll = rng();
    tick();
    if (roll < 0.22) {
      count("add");
      await repo.add({ ...pick(WORKS), owned: rng() < 0.7 });
      await snapshot(repo);
    } else if (roll < 0.48) {
      const live = await repo.list();
      if (!live.length) continue;
      count("update");
      const target = pick(live);
      await repo.update(target.id, {
        status: rng() < 0.5 ? pick(STATUSES) : undefined,
        rating: rng() < 0.4 ? 1 + Math.floor(rng() * 5) : undefined,
        favorite: rng() < 0.3 ? rng() < 0.5 : undefined,
        owned: rng() < 0.3 ? rng() < 0.5 : undefined
      });
      await snapshot(repo);
    } else if (roll < 0.57) {
      const live = await repo.list();
      if (!live.length) continue;
      count("remove");
      await repo.remove(pick(live).id);
      await snapshot(repo);
    } else if (roll < 0.62) {
      count("follow");
      const key = pick(AUTHORS);
      await repo.upsertFollowedAuthor(key, key.toUpperCase(), new Date().toISOString());
      await snapshot(repo);
    } else if (roll < 0.65) {
      count("unfollow");
      await repo.removeFollowedAuthor(pick(AUTHORS));
      await snapshot(repo);
    } else if (roll < 0.72) {
      count("merge");
      await merge(repo);
    } else {
      count("sync");
      await syncOnce(repo, transports[index]);
    }
  }

  // Retour au calme : chaque appareil fusionne puis se synchronise, jusqu'à ce que plus rien ne bouge.
  const fingerprint = async () => JSON.stringify(await Promise.all(devices.map(async repo => [
    (await repo.changesSince("")).map(entry => `${entry.id}@${entry.updatedAt}${entry.deletedAt ? "x" : ""}`).sort(),
    (await repo.followedChangesSince("")).map(author => `${author.authorKey}@${author.updatedAt}${author.deletedAt ? "x" : ""}`).sort()
  ])));
  let previous = "";
  for (let round = 0; round < 10; round++) {
    for (let i = 0; i < devices.length; i++) {
      tick();
      if (i < active) await merge(devices[i]);
      tick();
      await syncOnce(devices[i], transports[i]);
    }
    const now = await fingerprint();
    if (now === previous) break;
    previous = now;
    if (round === 9) throw new Error(`Pas de convergence après 10 tours (seed ${seed})`);
  }

  // Vérifications.
  const liveExpected = [...expected.values()].filter(entry => !entry.deletedAt).map(comparable).sort();
  const reference = (await devices[0].list()).map(comparable).sort();
  if (JSON.stringify(reference) !== JSON.stringify(liveExpected)) {
    const missing = liveExpected.filter(entry => !reference.includes(entry));
    const extra = reference.filter(entry => !liveExpected.includes(entry));
    throw new Error(`seed ${seed}: la bibliothèque finale diffère du modèle.\n  attendu mais absent: ${missing.slice(0, 2).join(" | ")}\n  présent mais inattendu: ${extra.slice(0, 2).join(" | ")}`);
  }
  for (let i = 1; i < devices.length; i++) {
    const other = (await devices[i].list()).map(comparable).sort();
    if (JSON.stringify(other) !== JSON.stringify(reference)) throw new Error(`seed ${seed}: l'appareil ${i} diffère de l'appareil 0`);
  }
  const followedNow = async (repo: SqliteLibraryRepository) => JSON.stringify((await repo.listFollowedAuthors()).map(a => [a.authorKey, a.name, a.lastRefreshedAt]));
  const followedExpected = JSON.stringify([...expectedFollowed.values()].filter(a => !a.deletedAt).sort((x, y) => x.name.localeCompare(y.name)).map(a => [a.authorKey, a.name, a.lastRefreshedAt]));
  for (let i = 0; i < devices.length; i++) {
    if ((await followedNow(devices[i])) !== followedExpected) throw new Error(`seed ${seed}: auteurs suivis divergents sur l'appareil ${i}`);
  }
  // Idempotence : une synchronisation de plus ne change rien.
  for (let i = 0; i < devices.length; i++) {
    tick();
    const report = await syncOnce(devices[i], transports[i]);
    if (report.received !== 0 || report.followedReceived !== 0) throw new Error(`seed ${seed}: la synchronisation n'est pas stable (appareil ${i} a encore reçu ${report.received}+${report.followedReceived})`);
  }
  return { operations, liveEntries: reference.length, tombstones: [...expected.values()].filter(entry => entry.deletedAt).length };
}
