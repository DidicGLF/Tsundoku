import type { CredentialStore } from "./CredentialStore";

export class WebCredentialStore implements CredentialStore {
  constructor(
    private readonly storageKey = "tsundoku.v2.googleBooksApiKey"
  ) {}

  async getGoogleBooksApiKey(): Promise<string | null> {
    if (typeof window === "undefined") {
      return null;
    }
    return window.localStorage.getItem(this.storageKey);
  }

  async setGoogleBooksApiKey(key: string): Promise<void> {
    if (typeof window === "undefined") {
      throw new Error("Browser storage is not available.");
    }
    const normalized = key.trim();
    if (!normalized) {
      throw new Error("Google Books API key cannot be empty.");
    }
    window.localStorage.setItem(this.storageKey, normalized);
  }

  async deleteGoogleBooksApiKey(): Promise<void> {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.removeItem(this.storageKey);
  }
}
