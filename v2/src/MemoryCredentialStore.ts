import type { CredentialStore } from "./CredentialStore";

export class MemoryCredentialStore implements CredentialStore {
  private googleBooksApiKey: string | null = null;

  async getGoogleBooksApiKey(): Promise<string | null> {
    return this.googleBooksApiKey;
  }

  async setGoogleBooksApiKey(key: string): Promise<void> {
    const normalized = key.trim();
    if (!normalized) {
      throw new Error("Google Books API key cannot be empty.");
    }
    this.googleBooksApiKey = normalized;
  }

  async deleteGoogleBooksApiKey(): Promise<void> {
    this.googleBooksApiKey = null;
  }
}
