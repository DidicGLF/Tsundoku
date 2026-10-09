// Version de l'application : une seule source, les tags git (« git tag v0.3.0 »).
//   1. APP_VERSION dans l'environnement (le workflow de release la fixe depuis le tag) ;
//   2. sinon le dernier tag vX.Y.Z de l'historique : exactement dessus → « 0.3.0 », plus loin → « 0.3.0-dev.7 » (7 commits après) ;
//   3. sinon (pas de tag, clone sans historique) la version de apps/web/package.json.
// Usage : `node scripts/version.mjs` affiche la version ; `--code` affiche le versionCode d'Android.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** « v0.3.0 » → « 0.3.0 » ; renvoie undefined si ce n'est pas une version X.Y.Z (avec suffixe facultatif). */
export function cleanVersion(value) {
  const match = /^v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?)$/.exec(String(value ?? "").trim());
  return match?.[1];
}

/** Interprète la sortie de `git describe --tags --long` (« v0.2.0-5-gabc1234 »). */
export function versionFromDescribe(output) {
  const match = /^v(\d+\.\d+\.\d+)-(\d+)-g[0-9a-f]+$/.exec(String(output ?? "").trim());
  if (!match) return undefined;
  return Number(match[2]) === 0 ? match[1] : `${match[1]}-dev.${match[2]}`;
}

/** Entier croissant pour Android : majeur×10000 + mineur×100 + correctif (0.2.1 → 201). Les suffixes (-dev.7, -beta) sont ignorés. */
export function versionCode(version) {
  const [major, minor, patch] = String(version).split(/[-+]/)[0].split(".").map(Number);
  if (![major, minor, patch].every(Number.isInteger) || minor > 99 || patch > 99) throw new Error(`Version inutilisable pour Android : ${version}`);
  return major * 10000 + minor * 100 + patch;
}

export function appVersion(env = process.env) {
  const fromEnv = cleanVersion(env.APP_VERSION);
  if (fromEnv) return fromEnv;
  try {
    const described = execFileSync("git", ["describe", "--tags", "--match", "v[0-9]*", "--long"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const fromGit = versionFromDescribe(described);
    if (fromGit) return fromGit;
  } catch { /* pas de git ou pas de tag */ }
  return JSON.parse(readFileSync(join(root, "apps/web/package.json"), "utf8")).version;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const version = appVersion();
  console.log(process.argv.includes("--code") ? versionCode(version) : version);
}
