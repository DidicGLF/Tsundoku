export interface CredentialStore {
  getGoogleBooksApiKey(): Promise<string | null>;
  setGoogleBooksApiKey(key: string): Promise<void>;
  deleteGoogleBooksApiKey(): Promise<void>;
}
