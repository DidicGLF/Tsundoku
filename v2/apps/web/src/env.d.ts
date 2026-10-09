/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Adresse du serveur de synchronisation fournie avec l'application (`apps/web/.env`). */
  readonly VITE_SYNC_URL?: string;
}

/** Version de l'application, injectée au build (voir vite.config.ts). */
declare const __APP_VERSION__: string;
