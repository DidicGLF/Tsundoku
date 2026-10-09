import { Capacitor } from "@capacitor/core";
import { APP_VERSION, compareVersions } from "../lib/app-version";

/*
 * « Une nouvelle version est disponible » : seulement dans l'application Android (la version web se met à jour toute seule).
 * L'appareil interroge GitHub directement, au plus une fois par jour : aucune information n'est envoyée à notre serveur.
 * La dernière Release publiée fait foi (les pré-versions ne comptent pas : GitHub ne les renvoie pas comme « latest »).
 */
const LATEST_URL = "https://api.github.com/repos/DidicGLF/Tsundoku/releases/latest";
export const APK_URL = "https://github.com/DidicGLF/Tsundoku/releases/latest/download/tsundoku.apk";
const CHECKED_KEY = "tsundoku.update.checkedAt";
const AVAILABLE_KEY = "tsundoku.update.available";
const DISMISSED_KEY = "tsundoku.update.dismissed";
const INTERVAL = 24 * 3600 * 1000;

export interface AvailableUpdate { version: string }

const read = (key: string): string | null => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* facultatif */ } };

/** Version de la dernière Release à partir de la réponse de l'API GitHub, ou undefined si elle est inutilisable. */
export function latestVersionOf(release: unknown): string | undefined {
  const tag = (release as { tag_name?: unknown } | null)?.tag_name;
  const match = typeof tag === "string" ? /^v?(\d+\.\d+\.\d+)$/.exec(tag.trim()) : null;
  return match?.[1];
}

/** Faut-il prévenir ? Seulement si la Release est plus récente que l'application ET que cette version n'a pas été écartée. */
export function shouldNotify(current: string, latest: string | undefined, dismissed: string | null): boolean {
  if (!latest || /^(dev|0\.0\.0-test)/.test(current)) return false;
  return compareVersions(latest, current) > 0 && dismissed !== latest;
}

/** La mise à jour connue (sans réseau), pour l'afficher tout de suite. */
export function knownUpdate(current = APP_VERSION): AvailableUpdate | null {
  const latest = read(AVAILABLE_KEY) ?? undefined;
  return shouldNotify(current, latest, read(DISMISSED_KEY)) ? { version: latest! } : null;
}

/** Interroge GitHub si la dernière vérification date de plus d'un jour. Les erreurs réseau sont silencieuses. */
export async function checkForUpdate(now = Date.now(), fetchImpl: typeof fetch = (input, init) => fetch(input, init)): Promise<AvailableUpdate | null> {
  if (!Capacitor.isNativePlatform()) return null;
  const last = read(CHECKED_KEY);
  if (last === null || now - Number(last) >= INTERVAL) {
    try {
      const response = await fetchImpl(LATEST_URL, { headers: { Accept: "application/vnd.github+json" } });
      if (response.ok) {
        const latest = latestVersionOf(await response.json());
        if (latest) { write(AVAILABLE_KEY, latest); write(CHECKED_KEY, String(now)); }
      }
    } catch { /* hors ligne : on réessaiera au prochain lancement */ }
  }
  return knownUpdate();
}

/** « Plus tard » : on ne reparle pas de cette version (une plus récente sera annoncée). */
export function dismissUpdate(version: string): void {
  write(DISMISSED_KEY, version);
}
