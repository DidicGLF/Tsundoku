/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Adresse du serveur de synchronisation fournie avec l'application (`apps/web/.env.production`). */
  readonly VITE_SYNC_URL?: string;
}
