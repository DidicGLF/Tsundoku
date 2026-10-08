import type { CredentialStore } from "./CredentialStore";

export class WebCredentialStore implements CredentialStore {
  /** Ancienne clé de stockage, lue une fois puis abandonnée. */
  private static readonly LEGACY_KEY = "tsundoku.v2.googleBooksApiKey";

  constructor(private readonly storageKey = "tsundoku.googleBooksApiKey") {}
  async getGoogleBooksApiKey() {
    if (typeof window === "undefined") return null;
    const current = window.localStorage.getItem(this.storageKey);
    if (current) return current;
    const legacy = window.localStorage.getItem(WebCredentialStore.LEGACY_KEY);
    if (legacy) {
      window.localStorage.setItem(this.storageKey, legacy);
      window.localStorage.removeItem(WebCredentialStore.LEGACY_KEY);
    }
    return legacy;
  }
  async setGoogleBooksApiKey(key: string) {
    if (typeof window === "undefined") throw new Error("Browser storage is not available.");
    const value = key.trim();
    if (!value) throw new Error("Google Books API key cannot be empty.");
    window.localStorage.setItem(this.storageKey, value);
  }
  async deleteGoogleBooksApiKey() {
    if (typeof window !== "undefined") window.localStorage.removeItem(this.storageKey);
  }
}
