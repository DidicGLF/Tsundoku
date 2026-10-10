import pg from "pg";
import { createApp, DEFAULT_LIMITS, prepareDatabase, purgeDeleted } from "./app.js";

const databaseUrl = process.env.DATABASE_URL ?? "";
const port = Number(process.env.PORT ?? 8787);
// Par défaut, uniquement cette machine : l'accès extérieur passe par `tailscale serve`.
const host = process.env.HOST ?? "127.0.0.1";

if (!databaseUrl) { console.error("DATABASE_URL manquant."); process.exit(1); }

const pool = new pg.Pool({ connectionString: databaseUrl, max: 5 });
await prepareDatabase(pool);

// Ménage quotidien : les suppressions vieilles de plus de 90 jours n'ont plus à être conservées.
const purge = () => purgeDeleted(pool).then(
  ({ entries, followed }) => { if (entries + followed) console.log(`Ménage : ${entries} fiche(s) et ${followed} auteur(s) supprimés depuis plus de 90 jours effacés.`); },
  error => console.error("Ménage impossible :", error instanceof Error ? error.message : error)
);
void purge();
setInterval(purge, 24 * 60 * 60 * 1000).unref();
createApp(pool, {
  maxUsers: Number(process.env.MAX_USERS ?? DEFAULT_LIMITS.maxUsers),
  maxEntriesPerUser: Number(process.env.MAX_ENTRIES_PER_USER ?? DEFAULT_LIMITS.maxEntriesPerUser),
  requestsPerMinute: DEFAULT_LIMITS.requestsPerMinute,
  newUsersPerHour: Number(process.env.NEW_USERS_PER_HOUR ?? DEFAULT_LIMITS.newUsersPerHour),
  pairingTtlSeconds: DEFAULT_LIMITS.pairingTtlSeconds,
  claimsPerMinute: DEFAULT_LIMITS.claimsPerMinute
}).listen(port, host, () => console.log(`Tsundoku sync : http://${host}:${port}`));
