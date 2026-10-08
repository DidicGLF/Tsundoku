/*
 * Google Books compte 1000 requêtes par jour et par projet, remises à zéro à minuit (heure du
 * Pacifique, 9 h en France l'été). Une fois le plafond atteint (HTTP 429), inutile de continuer
 * à insister : on s'abstient d'appeler Google jusqu'à la remise à zéro.
 */
const KEY = "tsundoku.google-quota-until";

/** Prochain minuit à Los Angeles, en millisecondes epoch. */
export function nextQuotaReset(now = Date.now()): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles", hour: "numeric", minute: "numeric", second: "numeric", hourCycle: "h23"
  }).formatToParts(new Date(now));
  const value = (type: string) => Number(parts.find(part => part.type === type)?.value ?? 0);
  const elapsed = (value("hour") * 3600 + value("minute") * 60 + value("second")) * 1000;
  return now + 86_400_000 - elapsed;
}

export function markGoogleQuotaExhausted(now = Date.now()): void {
  try { localStorage.setItem(KEY, String(nextQuotaReset(now))); } catch { /* facultatif */ }
}

export function clearGoogleQuotaFlag(): void {
  try { localStorage.removeItem(KEY); } catch { /* facultatif */ }
}

/** Heure de remise à zéro si le quota est épuisé, sinon undefined. */
export function googleQuotaResetAt(now = Date.now()): number | undefined {
  try {
    const until = Number(localStorage.getItem(KEY));
    return until > now ? until : undefined;
  } catch { return undefined; }
}

export function formatResetTime(until: number): string {
  return new Date(until).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}
