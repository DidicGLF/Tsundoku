/** Créé au démarrage s'il n'existe pas : le serveur n'a rien à préparer à la main. */
export const SCHEMA = `
CREATE SEQUENCE IF NOT EXISTS sync_seq;
CREATE TABLE IF NOT EXISTS entries (
  id         text PRIMARY KEY,
  doc        jsonb  NOT NULL,
  updated_at text   NOT NULL,
  seq        bigint NOT NULL DEFAULT nextval('sync_seq')
);
CREATE INDEX IF NOT EXISTS entries_seq ON entries(seq);
CREATE TABLE IF NOT EXISTS followed (
  author_key text PRIMARY KEY,
  doc        jsonb  NOT NULL,
  updated_at text   NOT NULL,
  seq        bigint NOT NULL DEFAULT nextval('sync_seq')
);
CREATE INDEX IF NOT EXISTS followed_seq ON followed(seq);
`;
