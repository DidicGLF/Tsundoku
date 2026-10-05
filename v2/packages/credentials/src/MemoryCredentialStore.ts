import type { CredentialStore } from "./CredentialStore";

export class MemoryCredentialStore implements CredentialStore {
  private key: string | null = null;
  async getGoogleBooksApiKey() { return this.key; }
  async setGoogleBooksApiKey(key: string) {
    const value = key.trim();
    if (!value) throw new Error("Google Books API key cannot be empty.");
    this.key = value;
  }
  async deleteGoogleBooksApiKey() { this.key = null; }
}
