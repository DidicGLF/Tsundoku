import { createHttpTransport, SyncServerError, type SyncReport } from "@tsundoku/database";
import { deleteSecret, getSecret, setSecret } from "./credentials";
import { syncLibrary, type LibraryBook } from "./library";

/*
 * Synchronisation avec le serveur de l'utilisateur. L'adresse est un réglage ordinaire ; le jeton est un secret
 * (stockage sécurisé sur Android) qui ne quitte jamais l'appareil, hors des requêtes vers ce serveur.
 */
const URL_KEY = "tsundoku.sync.url";
const LAST_KEY = "tsundoku.sync.last";
const TOKEN_SECRET = "syncToken";

export interface SyncConfig { url: string; token: string }

/** Adresse normalisée : HTTPS obligatoire (Android bloque le HTTP depuis l'application), sauf en local pour le développement. */
export function normalizeServerUrl(value: string): string {
  const url = value.trim().replace(/\/+$/, "");
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error("Adresse invalide : elle doit ressembler à https://mon-serveur.ts.net"); }
  const local = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.protocol !== "https:" && !(local && parsed.protocol === "http:")) throw new Error("L'adresse doit commencer par https://");
  return `${parsed.origin}${parsed.pathname === "/" ? "" : parsed.pathname}`;
}

export async function getSyncConfig(): Promise<SyncConfig | null> {
  let url: string | null = null;
  try { url = localStorage.getItem(URL_KEY); } catch { /* pas de stockage */ }
  const token = await getSecret(TOKEN_SECRET).catch(() => null);
  return url && token ? { url, token } : null;
}

export async function saveSyncConfig(config: SyncConfig): Promise<SyncConfig> {
  const url = normalizeServerUrl(config.url);
  const token = config.token.trim();
  if (token.length < 16) throw new Error("Le jeton est trop court : copie-le en entier depuis le serveur.");
  await createHttpTransport(url, token).ping();
  localStorage.setItem(URL_KEY, url);
  await setSecret(TOKEN_SECRET, token);
  return { url, token };
}

export async function clearSyncConfig(): Promise<void> {
  try { localStorage.removeItem(URL_KEY); localStorage.removeItem(LAST_KEY); } catch { /* rien à effacer */ }
  await deleteSecret(TOKEN_SECRET);
  setStatus({ state: "idle" });
}

/* ---- État affiché dans les paramètres ---- */

export interface SyncStatus {
  state: "idle" | "running" | "ok" | "error";
  at?: string;
  error?: string;
  report?: SyncReport & { merged: number };
}

let status: SyncStatus = (() => {
  try { return { state: "idle", at: localStorage.getItem(LAST_KEY) ?? undefined } as SyncStatus; } catch { return { state: "idle" } as SyncStatus; }
})();
const listeners = new Set<() => void>();

function setStatus(next: SyncStatus) {
  status = next;
  listeners.forEach(listener => listener());
}

export const getSyncStatus = () => status;
export function subscribeSync(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Une seule synchronisation à la fois ; sans serveur configuré, rien ne se passe. */
let current: Promise<LibraryBook[] | null> | null = null;

export function runSync(): Promise<LibraryBook[] | null> {
  current ??= (async () => {
    try {
      const config = await getSyncConfig();
      if (!config) return null;
      setStatus({ ...status, state: "running", error: undefined });
      const { library, report, merged } = await syncLibrary(createHttpTransport(config.url, config.token));
      const at = new Date().toISOString();
      try { localStorage.setItem(LAST_KEY, at); } catch { /* facultatif */ }
      setStatus({ state: "ok", at, report: { ...report, merged } });
      return library;
    } catch (error) {
      const message = error instanceof SyncServerError || error instanceof Error ? error.message : "Synchronisation impossible.";
      setStatus({ ...status, state: "error", error: message });
      return null;
    } finally {
      current = null;
    }
  })();
  return current;
}
