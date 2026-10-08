import { canonicalAuthorIdentity, getJson, normalizeText } from "@tsundoku/book-sources";
import {
  buildAuthorInfo, isAuthorSummary, type AuthorInfo, type OpenLibraryAuthor, type WikipediaSummary
} from "../lib/author-info";

/*
 * Informations sur un auteur : Wikipédia (français) pour la description, le résumé et la photo,
 * Open Library pour les dates et en secours. Une seule requête Wikipédia par auteur, mise en cache
 * (trouvé : 30 jours, introuvable : 7 jours ; une panne réseau n'est jamais mémorisée).
 */
const CACHE_KEY = "tsundoku.author-info.v1";
const FOUND_TTL = 30 * 24 * 3600 * 1000;
const MISSING_TTL = 7 * 24 * 3600 * 1000;

interface CacheEntry { at: number; info: AuthorInfo | null }
let cache: Record<string, CacheEntry> | null = null;

function loadCache(): Record<string, CacheEntry> {
  if (cache) return cache;
  try { cache = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "{}") as Record<string, CacheEntry>; }
  catch { cache = {}; }
  return cache ?? (cache = {});
}

function saveCache(): void {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch { /* cache facultatif */ }
}

/** Valeur en cache : undefined = à chercher, null = on sait qu'il n'y a rien. */
export function cachedAuthorInfo(authorName: string, now = Date.now()): AuthorInfo | null | undefined {
  const entry = loadCache()[canonicalAuthorIdentity(authorName)];
  if (!entry) return undefined;
  const ttl = entry.info ? FOUND_TTL : MISSING_TTL;
  return now - entry.at < ttl ? entry.info : undefined;
}

const isNotFound = (error: unknown) => /HTTP 404/.test(String((error as Error)?.message));

async function fetchWikipedia(name: string): Promise<WikipediaSummary | null> {
  const title = encodeURIComponent(name.trim().replace(/\s+/g, "_"));
  try {
    const summary = await getJson<WikipediaSummary>(`https://fr.wikipedia.org/api/rest_v1/page/summary/${title}`, { timeoutMs: 8000, retries: 0 });
    return isAuthorSummary(summary, name) ? summary : null;
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

async function fetchOpenLibrary(name: string, withDetails: boolean): Promise<OpenLibraryAuthor | null> {
  const params = new URLSearchParams({ q: name, limit: "5" });
  const search = await getJson<{ docs?: Array<OpenLibraryAuthor & { key?: string }> }>(
    `https://openlibrary.org/search/authors.json?${params}`, { timeoutMs: 8000, retries: 0 }
  );
  const wanted = normalizeText(name);
  const doc = (search.docs ?? []).find(candidate => normalizeText(candidate.name ?? "") === wanted);
  if (!doc) return null;
  if (!withDetails || !doc.key) return doc;
  try {
    const details = await getJson<OpenLibraryAuthor>(`https://openlibrary.org/authors/${doc.key}.json`, { timeoutMs: 8000, retries: 0 });
    return { ...doc, bio: details.bio, photos: details.photos };
  } catch { return doc; }
}

/**
 * Cherche les informations d'un auteur. Renvoie null s'il n'y en a pas ; lève une erreur
 * seulement si le réseau est en panne (rien n'est alors mémorisé).
 */
export async function fetchAuthorInfo(authorName: string): Promise<AuthorInfo | null> {
  const cached = cachedAuthorInfo(authorName);
  if (cached !== undefined) return cached;

  const wikipedia = await fetchWikipedia(authorName);
  // Open Library : dates et nombre d'œuvres ; détails (bio, photo) seulement sans Wikipédia.
  const openLibrary = await fetchOpenLibrary(authorName, !wikipedia).catch(() => null);
  const info = buildAuthorInfo(wikipedia, openLibrary);

  loadCache()[canonicalAuthorIdentity(authorName)] = { at: Date.now(), info };
  saveCache();
  return info;
}
