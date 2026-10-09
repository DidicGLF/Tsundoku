import pg from "pg";
import { createApp, prepareDatabase } from "./app.js";

const token = process.env.SYNC_TOKEN ?? "";
const databaseUrl = process.env.DATABASE_URL ?? "";
const port = Number(process.env.PORT ?? 8787);
// Par défaut, uniquement cette machine : l'accès extérieur passe par `tailscale serve`.
const host = process.env.HOST ?? "127.0.0.1";

if (!databaseUrl) { console.error("DATABASE_URL manquant."); process.exit(1); }
if (token.length < 32) { console.error("SYNC_TOKEN manquant ou trop court (32 caractères minimum)."); process.exit(1); }

const pool = new pg.Pool({ connectionString: databaseUrl, max: 5 });
await prepareDatabase(pool);
createApp(pool, token).listen(port, host, () => console.log(`Tsundoku sync : http://${host}:${port}`));
