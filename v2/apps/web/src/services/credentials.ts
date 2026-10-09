import { SecureStorage } from "@aparajita/capacitor-secure-storage";
import { Capacitor } from "@capacitor/core";
import {
  WebCredentialStore,
  isProbablyGoogleBooksApiKey,
  type CredentialStore
} from "@tsundoku/credentials";

import { clearGoogleQuotaFlag } from "./googleQuota";

const GOOGLE_BOOKS_KEY = "googleBooksApiKey";
const PREFIX = "tsundoku.";
const LEGACY_PREFIX = "tsundoku.v2.";

class AndroidCredentialStore implements CredentialStore {
  private initialization: Promise<void> | null = null;

  /** Une seule initialisation, même si plusieurs appels arrivent en même temps (le préfixe est global). */
  ready(): Promise<void> {
    this.initialization ??= this.initialize();
    return this.initialization;
  }

  private async initialize() {
    // Ancien préfixe : la clé déjà enregistrée est reprise une fois sous le nouveau.
    await SecureStorage.setKeyPrefix(LEGACY_PREFIX);
    const legacy = await SecureStorage.getItem(GOOGLE_BOOKS_KEY).catch(() => null);
    await SecureStorage.setKeyPrefix(PREFIX);
    if (typeof legacy === "string" && legacy && !(await SecureStorage.getItem(GOOGLE_BOOKS_KEY))) {
      await SecureStorage.setItem(GOOGLE_BOOKS_KEY, legacy);
    }
    if (legacy) {
      await SecureStorage.setKeyPrefix(LEGACY_PREFIX);
      await SecureStorage.removeItem(GOOGLE_BOOKS_KEY).catch(() => undefined);
      await SecureStorage.setKeyPrefix(PREFIX);
    }
  }

  async getGoogleBooksApiKey(): Promise<string | null> {
    await this.ready();
    return SecureStorage.getItem(GOOGLE_BOOKS_KEY);
  }

  async setGoogleBooksApiKey(key: string): Promise<void> {
    const value = key.trim();
    if (!value) throw new Error("La clé Google Books ne peut pas être vide.");
    await this.ready();
    await SecureStorage.setItem(GOOGLE_BOOKS_KEY, value);
  }

  async deleteGoogleBooksApiKey(): Promise<void> {
    await this.ready();
    await SecureStorage.removeItem(GOOGLE_BOOKS_KEY);
  }
}

const androidStore = Capacitor.isNativePlatform() ? new AndroidCredentialStore() : null;
const credentialStore: CredentialStore = androidStore ?? new WebCredentialStore();

export function getCredentialStore(): CredentialStore {
  return credentialStore;
}

export async function hasGoogleBooksApiKey(): Promise<boolean> {
  return Boolean(await credentialStore.getGoogleBooksApiKey());
}

export async function saveGoogleBooksApiKey(key: string): Promise<void> {
  if (!isProbablyGoogleBooksApiKey(key)) {
    throw new Error("La clé Google Books semble invalide.");
  }
  await credentialStore.setGoogleBooksApiKey(key);
  // Une nouvelle clé peut venir d'un autre projet, donc d'un quota neuf.
  clearGoogleQuotaFlag();
}

export async function deleteGoogleBooksApiKey(): Promise<void> {
  await credentialStore.deleteGoogleBooksApiKey();
}

/* ---- Secrets divers (jeton de synchronisation) : stockage sécurisé sur Android, localStorage sur le web ---- */

const SECRET_PREFIX = "tsundoku.secret.";

export async function getSecret(name: string): Promise<string | null> {
  if (androidStore) {
    await androidStore.ready();
    return SecureStorage.getItem(name).then(value => (typeof value === "string" && value ? value : null));
  }
  try { return localStorage.getItem(SECRET_PREFIX + name); } catch { return null; }
}

export async function setSecret(name: string, value: string): Promise<void> {
  if (androidStore) {
    await androidStore.ready();
    await SecureStorage.setItem(name, value);
    return;
  }
  localStorage.setItem(SECRET_PREFIX + name, value);
}

export async function deleteSecret(name: string): Promise<void> {
  if (androidStore) {
    await androidStore.ready();
    await SecureStorage.removeItem(name).catch(() => undefined);
    return;
  }
  try { localStorage.removeItem(SECRET_PREFIX + name); } catch { /* rien à supprimer */ }
}
