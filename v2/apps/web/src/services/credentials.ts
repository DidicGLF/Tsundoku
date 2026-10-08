import { SecureStorage } from "@aparajita/capacitor-secure-storage";
import { Capacitor } from "@capacitor/core";
import {
  WebCredentialStore,
  isProbablyGoogleBooksApiKey,
  type CredentialStore
} from "@tsundoku/credentials";

import { clearGoogleQuotaFlag } from "./googleQuota";

const GOOGLE_BOOKS_KEY = "googleBooksApiKey";

class AndroidCredentialStore implements CredentialStore {
  private initialized = false;

  private async ready() {
    if (this.initialized) return;
    await SecureStorage.setKeyPrefix("tsundoku.v2.");
    this.initialized = true;
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

const credentialStore: CredentialStore = Capacitor.isNativePlatform()
  ? new AndroidCredentialStore()
  : new WebCredentialStore();

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
