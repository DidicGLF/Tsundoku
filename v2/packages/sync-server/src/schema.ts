/*
 * Schéma multi-utilisateurs. Un utilisateur = la clé de synchronisation générée par son application ;
 * le serveur n'en conserve que l'empreinte (SHA-256). Créé au démarrage s'il n'existe pas.
 */
export const SCHEMA = `
CREATE SEQUENCE IF NOT EXISTS sync_seq;

CREATE TABLE IF NOT EXISTS users (
  user_id    text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS entries (
  user_id    text   NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  id         text   NOT NULL,
  doc        jsonb  NOT NULL,
  updated_at text   NOT NULL,
  seq        bigint NOT NULL DEFAULT nextval('sync_seq'),
  PRIMARY KEY (user_id, id)
);
CREATE INDEX IF NOT EXISTS entries_user_seq ON entries(user_id, seq);

CREATE TABLE IF NOT EXISTS followed (
  user_id    text   NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  author_key text   NOT NULL,
  doc        jsonb  NOT NULL,
  updated_at text   NOT NULL,
  seq        bigint NOT NULL DEFAULT nextval('sync_seq'),
  PRIMARY KEY (user_id, author_key)
);
CREATE INDEX IF NOT EXISTS followed_user_seq ON followed(user_id, seq);

-- Codes de liaison : la clé de synchronisation, chiffrée par l'appareil avec le code court, valable quelques minutes
-- et à usage unique. Le serveur ne connaît ni le code ni la clé.
CREATE TABLE IF NOT EXISTS pairings (
  id         text PRIMARY KEY,
  user_id    text NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  payload    text NOT NULL,
  expires_at timestamptz NOT NULL
);
`;

/** Première version (un seul jeton, sans utilisateurs) : ses tables sont mises de côté, pas supprimées. */
export const LEGACY_RENAME = `
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'entries' AND table_schema = current_schema())
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'entries' AND column_name = 'user_id' AND table_schema = current_schema()) THEN
    ALTER TABLE entries RENAME TO entries_v1;
    ALTER INDEX IF EXISTS entries_seq RENAME TO entries_v1_seq;
    ALTER TABLE entries_v1 RENAME CONSTRAINT entries_pkey TO entries_v1_pkey;
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'followed' AND table_schema = current_schema()) THEN
      ALTER TABLE followed RENAME TO followed_v1;
      ALTER INDEX IF EXISTS followed_seq RENAME TO followed_v1_seq;
      ALTER TABLE followed_v1 RENAME CONSTRAINT followed_pkey TO followed_v1_pkey;
    END IF;
  END IF;
END $$;
`;
