import type { CredentialStore } from "./CredentialStore";

export class WebCredentialStore implements CredentialStore {
  constructor(private readonly storageKey = "tsundoku.v2.googleBooksApiKey") {}
  async getGoogleBooksApiKey() {
    return typeof window === "undefined" ? null : window.localStorage.getItem(this.storageKey);
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
