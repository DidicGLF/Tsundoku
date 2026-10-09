import { claimPairing, createHttpTransport, SyncServerError, type SyncReport } from "@tsundoku/database";
import { formatPairingCode, generatePairingCode, normalizePairingCode, openKey, pairingIdOf, sealKey } from "../lib/pairing";
import { generateSyncKey, keyFingerprint, parseSyncKey } from "../lib/sync-key";
import { deleteSecret, getSecret, setSecret } from "./credentials";
import { syncLibrary, type LibraryBook } from "./library";

/*
 * Synchronisation avec le serveur de l'application. L'utilisateur n'a rien à configurer : activer la synchronisation
 * génère une clé secrète aléatoire (rangée dans le stockage sécurisé), qui identifie sa bibliothèque sur le serveur.
 * Un autre appareil rejoint la même bibliothèque en saisissant ou en scannant cette clé. Elle ne quitte l'appareil
 * que dans les requêtes vers le serveur.
 */
const URL_KEY = "tsundoku.sync.url";
const ENABLED_KEY = "tsundoku.sync.enabled";
const LAST_KEY = "tsundoku.sync.last";
const KEY_SECRET = "syncKey";

export interface SyncConfig { url: string; key: string }

/** Adresse du serveur fournie avec l'application (vide si la version n'en a pas). */
export const DEFAULT_SERVER_URL: string = (import.meta.env.VITE_SYNC_URL ?? "").trim();

/** Adresse normalisée : HTTPS obligatoire (Android bloque le HTTP depuis l'application), sauf en local pour le développement. */
export function normalizeServerUrl(value: string): string {
  const url = value.trim().replace(/\/+$/, "");
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error("Adresse invalide : elle doit ressembler à https://mon-serveur.ts.net"); }
  const local = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.protocol !== "https:" && !(local && parsed.protocol === "http:")) throw new Error("L'adresse doit commencer par https://");
  return `${parsed.origin}${parsed.pathname === "/" ? "" : parsed.pathname}`;
}

const read = (name: string): string | null => { try { return localStorage.getItem(name); } catch { return null; } };

/** Adresse utilisée : celle choisie dans les réglages avancés, sinon celle de l'application. */
export function serverUrl(): string { return read(URL_KEY) || DEFAULT_SERVER_URL; }
export const isSyncEnabled = (): boolean => read(ENABLED_KEY) === "1";

export async function getSyncKey(): Promise<string | null> {
  return getSecret(KEY_SECRET).catch(() => null);
}

export async function getSyncConfig(): Promise<SyncConfig | null> {
  const url = serverUrl();
  const key = isSyncEnabled() ? await getSyncKey() : null;
  return url && key ? { url, key } : null;
}

/**
 * Active la synchronisation. Sans `existingKey`, une nouvelle bibliothèque est créée sur le serveur ;
 * avec, cet appareil rejoint celle de l'autre appareil. `customUrl` : adresse de serveur différente (réglages avancés).
 */
export async function enableSync(options: { existingKey?: string; customUrl?: string } = {}): Promise<string> {
  const url = options.customUrl?.trim() ? normalizeServerUrl(options.customUrl) : serverUrl();
  if (!url) throw new Error("Aucune adresse de serveur : renseigne-la dans les réglages avancés.");
  let key: string;
  if (options.existingKey !== undefined) {
    const parsed = parseSyncKey(options.existingKey);
    if (!parsed) throw new Error("Cette clé n'est pas valide : copie-la en entier depuis l'autre appareil.");
    key = parsed;
  } else {
    key = (await getSyncKey()) ?? generateSyncKey();
  }
  await createHttpTransport(url, key).ping();
  try {
    if (options.customUrl?.trim()) localStorage.setItem(URL_KEY, url);
    localStorage.setItem(ENABLED_KEY, "1");
  } catch { /* le stockage local est requis : sans lui, la synchro ne tiendrait pas au redémarrage */ throw new Error("Stockage de l'appareil indisponible."); }
  await setSecret(KEY_SECRET, key);
  return key;
}

/** Un code de liaison à taper sur l'autre appareil : la clé, chiffrée par ce code, attend quelques minutes sur le serveur. */
export async function createPairingCode(): Promise<{ code: string; expiresAt: number }> {
  const config = await getSyncConfig();
  if (!config) throw new Error("La synchronisation n'est pas activée sur cet appareil.");
  const code = generatePairingCode();
  const { id, payload } = await sealKey(code, config.key);
  const { expiresInSeconds } = await createHttpTransport(config.url, config.key).offerPairing(id, payload);
  return { code: formatPairingCode(code), expiresAt: Date.now() + expiresInSeconds * 1000 };
}

/** Rejoint une bibliothèque avec un code de liaison, ou avec la clé elle-même (copiée ou lue dans un QR code). */
export async function joinSync(input: string, customUrl?: string): Promise<void> {
  const trimmed = input.trim();
  let key = parseSyncKey(trimmed);
  if (!key) {
    const code = normalizePairingCode(trimmed);
    if (!code) throw new Error("Ce n'est ni un code de liaison (8 caractères, comme K7M4-QX2R) ni une clé de synchronisation.");
    const url = customUrl?.trim() ? normalizeServerUrl(customUrl) : serverUrl();
    if (!url) throw new Error("Aucune adresse de serveur : renseigne-la dans les réglages avancés.");
    key = await openKey(code, await claimPairing(url, await pairingIdOf(code)));
  }
  await enableSync({ existingKey: key, customUrl });
}

/** Arrête la synchronisation sur cet appareil ; la clé est conservée pour pouvoir la réactiver. */
export function disableSync(): void {
  try { localStorage.removeItem(ENABLED_KEY); } catch { /* rien à effacer */ }
  setStatus({ state: "idle", at: status.at });
}

/** Efface la bibliothèque du serveur puis la clé de cet appareil. Les autres appareils gardent leurs livres mais ne se synchronisent plus. */
export async function deleteServerData(): Promise<void> {
  const config = await getSyncConfig();
  const key = config?.key ?? await getSyncKey();
  if (key) await createHttpTransport(serverUrl(), key).deleteAccount();
  try { localStorage.removeItem(ENABLED_KEY); localStorage.removeItem(LAST_KEY); localStorage.removeItem(URL_KEY); } catch { /* rien à effacer */ }
  await deleteSecret(KEY_SECRET);
  setStatus({ state: "idle" });
}

/* ---- État affiché dans les paramètres ---- */

export interface SyncStatus {
  state: "idle" | "running" | "ok" | "error";
  at?: string;
  error?: string;
  report?: SyncReport & { merged: number };
  /** Fiches de cette bibliothèque sur le serveur (serveurs récents seulement). */
  serverEntries?: number;
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
      const transport = createHttpTransport(config.url, config.key);
      const { library, report, merged } = await syncLibrary(transport, await keyFingerprint(config.key));
      const serverEntries = await transport.ping().then(info => info.entries, () => undefined);
      const at = new Date().toISOString();
      try { localStorage.setItem(LAST_KEY, at); } catch { /* facultatif */ }
      setStatus({ state: "ok", at, report: { ...report, merged }, serverEntries });
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

/** Identifiant court de la bibliothèque synchronisée, identique sur tous ses appareils. */
export async function currentLibraryFingerprint(): Promise<string | null> {
  const key = await getSyncKey();
  return key ? keyFingerprint(key) : null;
}
